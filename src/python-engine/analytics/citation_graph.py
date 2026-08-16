"""
Citation Graph Builder
Constructs directed citation and co-occurrence graphs using NetworkX.
Calculates centrality metrics, community detection, and authority node mapping.
Optimized: bulk-load from Polars DataFrames, avoid iter_rows.
"""

import json
import logging
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any
from collections import Counter, defaultdict
from urllib.parse import urlparse

import polars as pl
import networkx as nx

from brand_utils import build_brand_patterns

logger = logging.getLogger(__name__)

try:
    from networkx.algorithms.community import louvain_communities
    COMMUNITY_AVAILABLE = True
except ImportError:
    COMMUNITY_AVAILABLE = False


class CitationGraphBuilder:
    def __init__(self, config: Dict):
        self.config = config
        self.graph_config = config.get('analytics', {}).get('graph', {})
        self.entity_config = config.get('entity_maps', {}).get('entity_maps', {})
        self.directed = self.graph_config.get('directed', True)
        self.min_edge_weight = self.graph_config.get('min_edge_weight', 2)
        self.max_nodes = self.graph_config.get('max_graph_nodes', 10000)
        self.authority_domains = {}
        for source in self.entity_config.get('external_authority_sources', []):
            self.authority_domains[source['domain']] = source
        your_brand = self.entity_config.get('your_brand', {}) or {}
        self.primary_brand = your_brand.get('primary_name', '')
        self._brand_by_name = {brand: re.compile(pat, re.IGNORECASE) for brand, pat in build_brand_patterns(self.entity_config).items()}

    def _extract_domain(self, url: str) -> Optional[str]:
        try:
            domain = urlparse(url).netloc.lower()
            return domain[4:] if domain.startswith('www.') else domain or None
        except Exception:
            return None

    def build_all_graphs(self, df: pl.DataFrame) -> Dict[str, nx.Graph]:
        graphs = {}
        graphs['citation_graph'] = self._build_citation_graph(df)
        graphs['cooccurrence_graph'] = self._build_cooccurrence_graph(df)
        graphs['entity_citation_graph'] = self._build_entity_citation_graph(df)
        graphs['model_comparison_graph'] = self._build_model_comparison_graph(df)
        for name, graph in graphs.items():
            self._compute_centrality_metrics(graph)
            if COMMUNITY_AVAILABLE and graph.number_of_nodes() > 10:
                self._detect_communities(graph)
        logger.info(f"Built {len(graphs)} graphs with combined {sum(g.number_of_nodes() for g in graphs.values())} nodes")
        return graphs

    def _build_citation_graph(self, df: pl.DataFrame) -> nx.DiGraph:
        G = nx.DiGraph()
        rows = df.select([
            pl.col('citations'), pl.col('primary_brand_mention'), pl.col('model_id')
        ]).iter_rows(named=True)

        for row in rows:
            citations = row.get('citations', [])
            brand = row.get('primary_brand_mention', '')
            model_id = row.get('model_id', '')
            if not citations or not isinstance(citations, list):
                continue
            for citation in citations:
                if not isinstance(citation, dict):
                    continue
                url = citation.get('url', '')
                if not url:
                    continue
                domain = self._extract_domain(url)
                if not domain:
                    continue
                source_node = f"source:{domain}"
                brand_node = f"brand:{brand}" if brand else None
                if brand_node:
                    if G.has_edge(source_node, brand_node):
                        G[source_node][brand_node]['weight'] += 1
                        G[source_node][brand_node]['citations'].append(url)
                    else:
                        G.add_edge(source_node, brand_node, weight=1, citations=[url], model_ids=[model_id])
                model_node = f"model:{model_id}"
                if G.has_edge(model_node, source_node):
                    G[model_node][source_node]['weight'] += 1
                else:
                    G.add_edge(model_node, source_node, weight=1)
        self._filter_low_weight_edges(G)
        logger.info(f"Citation graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
        return G

    def _build_cooccurrence_graph(self, df: pl.DataFrame) -> nx.Graph:
        G = nx.Graph()
        brand_counter = Counter()
        brand_pair_counter = Counter()

        # ResponseExtractor tags brand entities as 'your_brand' or 'competitor'
        # (never the bare 'brand' type), so accept all brand-like types and
        # normalize to the configured brand name via the flexible matcher.
        brand_types = {'brand', 'your_brand', 'competitor'}

        def _normalize(name: str) -> str:
            if not name:
                return None
            lowered = name.lower()
            for brand in self._brand_by_name:
                if self._brand_by_name[brand].search(name):
                    return brand
            return name

        brand_name_patterns = {}
        for brand, pat in self._brand_by_name.items():
            brand_name_patterns[brand] = pat

        for entities in df['entities'].to_list():
            if not entities or not isinstance(entities, list):
                continue
            brands = []
            for e in entities:
                if not isinstance(e, dict) or not e.get('name'):
                    continue
                if e.get('type') not in brand_types:
                    continue
                normalized = _normalize(e['name'])
                if normalized:
                    brands.append(normalized)
            for brand in brands:
                brand_counter[brand] += 1
            for i, b1 in enumerate(brands):
                for b2 in brands[i+1:]:
                    brand_pair_counter[tuple(sorted([b1, b2]))] += 1
        for brand, count in brand_counter.items():
            G.add_node(f"brand:{brand}", type='brand', mention_count=count)
        for (b1, b2), count in brand_pair_counter.items():
            if count >= self.min_edge_weight:
                G.add_edge(f"brand:{b1}", f"brand:{b2}", weight=count,
                          co_occurrence_rate=count / max(brand_counter[b1], brand_counter[b2], 1))
        logger.info(f"Co-occurrence graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
        return G

    def _build_entity_citation_graph(self, df: pl.DataFrame) -> nx.DiGraph:
        G = nx.DiGraph()
        entity_url_weights = defaultdict(lambda: defaultdict(int))

        for row in df.select([
            pl.col('primary_brand_mention').alias('brand'),
            pl.col('citations')
        ]).iter_rows(named=True):
            brand = row.get('brand', '')
            citations = row.get('citations', [])
            if not brand:
                continue
            if citations and isinstance(citations, list):
                for citation in citations:
                    if isinstance(citation, dict) and citation.get('url'):
                        domain = self._extract_domain(citation['url'])
                        if domain:
                            entity_url_weights[brand][domain] += 1

        for brand, url_weights in entity_url_weights.items():
            brand_node = f"brand:{brand}"
            G.add_node(brand_node, type='brand')
            sorted_urls = sorted(url_weights.items(), key=lambda x: x[1], reverse=True)[:50]
            for domain, weight in sorted_urls:
                source_node = f"source:{domain}"
                G.add_node(source_node, type='source', domain=domain,
                          authority_weight=self.authority_domains.get(domain, {}).get('authority_weight', 0.5))
                G.add_edge(source_node, brand_node, weight=weight)
        logger.info(f"Entity-citation graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
        return G

    def _build_model_comparison_graph(self, df: pl.DataFrame) -> nx.DiGraph:
        G = nx.DiGraph()
        model_brand_counts = defaultdict(lambda: defaultdict(int))
        for row in df.select(['model_id', 'primary_brand_mention']).iter_rows(named=True):
            model_id = row.get('model_id', '')
            brand = row.get('primary_brand_mention', '')
            if model_id and brand:
                model_brand_counts[model_id][brand] += 1
        for model_id, brand_counts in model_brand_counts.items():
            model_node = f"model:{model_id}"
            G.add_node(model_node, type='model')
            total = sum(brand_counts.values())
            for brand, count in brand_counts.items():
                brand_node = f"brand:{brand}"
                G.add_node(brand_node, type='brand')
                G.add_edge(model_node, brand_node, weight=count, share=count/total if total > 0 else 0)
        logger.info(f"Model comparison graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
        return G

    def _compute_centrality_metrics(self, G: nx.Graph):
        if G.number_of_nodes() == 0:
            return
        try:
            in_deg = nx.in_degree_centrality(G) if isinstance(G, nx.DiGraph) else nx.degree_centrality(G)
            nx.set_node_attributes(G, in_deg, 'in_degree_centrality')
        except Exception:
            pass
        try:
            if isinstance(G, nx.DiGraph):
                pagerank = nx.pagerank(G, weight='weight')
                nx.set_node_attributes(G, pagerank, 'pagerank')
        except Exception:
            pass
        try:
            if isinstance(G, nx.DiGraph) and G.number_of_nodes() < 5000:
                betweenness = nx.betweenness_centrality(G, weight='weight')
                nx.set_node_attributes(G, betweenness, 'betweenness_centrality')
        except Exception:
            pass

    def _detect_communities(self, G: nx.Graph):
        if not COMMUNITY_AVAILABLE or G.number_of_nodes() < 10:
            return
        try:
            communities = louvain_communities(G if isinstance(G, nx.Graph) else G.to_undirected(), weight='weight', seed=42)
            for i, community in enumerate(communities):
                for node in community:
                    if node in G.nodes:
                        G.nodes[node]['community'] = i
            logger.info(f"Detected {len(communities)} communities")
        except Exception as e:
            logger.warning(f"Community detection failed: {e}")

    def _filter_low_weight_edges(self, G: nx.Graph):
        edges_to_remove = [(u, v) for u, v, d in G.edges(data=True) if d.get('weight', 0) < self.min_edge_weight]
        G.remove_edges_from(edges_to_remove)

    def get_stats(self, graphs: Dict[str, nx.Graph]) -> Dict:
        stats = {
            'graph_count': len(graphs), 'graphs': {},
            'missing_authority_nodes': [], 'competitor_dominant_sources': [],
            'your_brand_citation_sources': []
        }
        for name, graph in graphs.items():
            graph_info = {
                'nodes': graph.number_of_nodes(), 'edges': graph.number_of_edges(),
                'density': nx.density(graph) if graph.number_of_nodes() > 1 else 0,
                'components': nx.number_weakly_connected_components(graph) if isinstance(graph, nx.DiGraph) else nx.number_connected_components(graph)
            }
            brand_nodes = [n for n in graph.nodes if n.startswith('brand:')]
            source_nodes = [n for n in graph.nodes if n.startswith('source:')]
            model_nodes = [n for n in graph.nodes if n.startswith('model:')]
            graph_info['brand_nodes'] = len(brand_nodes)
            graph_info['source_nodes'] = len(source_nodes)
            graph_info['model_nodes'] = len(model_nodes)
            if 'pagerank' in graph.nodes and brand_nodes:
                brand_pagerank = {n: graph.nodes[n].get('pagerank', 0) for n in brand_nodes}
                graph_info['top_brands_by_pagerank'] = sorted(brand_pagerank.items(), key=lambda x: x[1], reverse=True)[:10]
            if 'in_degree_centrality' in graph.nodes and source_nodes:
                source_centrality = {n: graph.nodes[n].get('in_degree_centrality', 0) for n in source_nodes}
                graph_info['top_sources_by_centrality'] = sorted(source_centrality.items(), key=lambda x: x[1], reverse=True)[:10]
            stats['graphs'][name] = graph_info

        entity_citation = graphs.get('entity_citation_graph')
        if entity_citation and isinstance(entity_citation, nx.DiGraph):
            self._find_missing_authority_nodes(entity_citation, stats)
        return stats

    def _find_missing_authority_nodes(self, graph: nx.DiGraph, stats: Dict):
        competitor_sources = defaultdict(list)
        your_sources = set()
        primary_brand_node = f'brand:{self.primary_brand}' if self.primary_brand else None
        for u, v, data in graph.edges(data=True):
            if primary_brand_node and v == primary_brand_node and u.startswith('source:'):
                your_sources.add(u.replace('source:', ''))
            elif v.startswith('brand:') and v != primary_brand_node and u.startswith('source:'):
                competitor_sources[v.replace('brand:', '')].append({'domain': u.replace('source:', ''), 'weight': data.get('weight', 0)})
        for competitor, sources in competitor_sources.items():
            for source in sources:
                if source['domain'] not in your_sources and source['weight'] >= self.min_edge_weight:
                    stats['missing_authority_nodes'].append({
                        'domain': source['domain'], 'weight': source['weight'],
                        'competitor': competitor,
                        'authority_weight': self.authority_domains.get(source['domain'], {}).get('authority_weight', 0.5)
                    })
        stats['missing_authority_nodes'].sort(key=lambda x: x['weight'], reverse=True)
        stats['missing_authority_nodes'] = stats['missing_authority_nodes'][:20]
        for source in your_sources:
            for u, v, d in graph.edges(data=True):
                if u == f"source:{source}" and v.startswith('brand:') and v != primary_brand_node:
                    stats['your_brand_citation_sources'].append({
                        'domain': source, 'also_cites_competitor': v.replace('brand:', ''),
                        'weight': d.get('weight', 0)
                    })

    def save_graphs(self, graphs: Dict[str, nx.Graph], output_dir: Path):
        graphs_dir = output_dir / 'graphs'
        graphs_dir.mkdir(exist_ok=True)
        for name, graph in graphs.items():
            graph_data = nx.node_link_data(graph)
            with open(graphs_dir / f'{name}.json', 'w') as f:
                json.dump(graph_data, f, indent=2, default=str)
            logger.info(f"Saved graph: {name}")
        try:
            from pyvis.network import Network
            entity_citation = graphs.get('entity_citation_graph')
            if entity_citation and entity_citation.number_of_nodes() > 0:
                net = Network(height='800px', width='100%', directed=True, notebook=False)
                net.from_nx(entity_citation)
                net.save_graph(str(graphs_dir / 'entity_citation_interactive.html'))
        except ImportError:
            pass
        except Exception as e:
            logger.warning(f"Failed to create interactive graph: {e}")
