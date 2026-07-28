// sections.js - Concise AEO Analysis with Business Impact Estimates
function sectionHeader(num, title, subtitle, icon) {  return `<div class="res-section">    <div class="res-section-header" onclick="toggleSection(this)">      <span class="section-chevron">&#9660;</span>      <div class="section-icon-wrap">${icon||'&#128202;'}</div>      <div class="section-title-group">        <div class="section-title-row">          <span class="section-num">${num}</span>          <h2>${title}</h2>          <span class="section-complete-badge">Complete</span>        </div>        <p class="section-desc">${subtitle}</p>      </div>    </div>    <div class="res-section-body">`;}

function businessImpact(title, impacts) {  let h = `<div class="res-business-impact"><h4>&#9878; Business Impact: ${title}</h4>`;  impacts.forEach(i => { h += `<div class="impact-item">${i}</div>`; });
  return h + '</div>';}

function implGuide(title, steps) {  let h = `<div class="res-impl-guide"><h4>&#9881; Implementation Guide: ${title}</h4><ol>`;  steps.forEach(s => { h += `<li>${s}</li>`; });
  return h + '</ol></div>';}

function deepAnalysis(text) {  return `<div class="res-deep">${text}</div>`;}

function sectionClose() {  return '</div></div>';}

// ── Estimates for Business Impact ──
const EST = {  agency_monthly: '$15K-$25K/month',  one_time_seo: '$5K-$10K',  monthly_content: '$3K-$8K/month',  pipeline_50m: '$2M-$4M',  conv_chatgpt: '15.9%',  conv_google: '1.76%',  conv_multiplier: '4.4x',  wikipedia_prune: '3B+ entities',  zero_click: '69%',  aio_trigger: '48%',  geo_market: '$1.8B',  geo_cagr: '64%',  pct_measure: '14%',  pct_enterprise_3plus: '81%',  top5_citation: '38%',  top10_citation: '54%',  pct_third_party: '85%',  reddit_growth: '450%',  pct_genz_ai: '50%+',};
// ══════════════════════════════════════════════════════════════
// SECTION 1: EXECUTIVE SUMMARY
// ══════════════════════════════════════════════════════════════
function renderSection1(s) {  const ts=s.triple_stats||{};
const gs=s.graph_stats||{};
const emb=s.embedding_analysis||{};
const sent=s.sentiment_matrix||{};
const sm=s.somv||{};
const overall=sm.overall||{};
const bs=overall.brand_stats||{};
const recs=s.recommendations||[];
const biases=sent.detected_biases||[];
const hs=sent.hallucination_signals||[];
const brandProfiles=Object.keys(emb.brand_vector_profiles||{});
const clusterCount=(emb.embedding_clusters||[]).length;
const ragPct=s.attribution_stats?.rag_enabled_count&&s.attribution_stats?.total_responses?((s.attribution_stats.rag_enabled_count/s.attribution_stats.total_responses)*100).toFixed(0):'-';
  let h = sectionHeader(1, 'Executive Summary', `Key metrics across all 8 analysis stages. AI search visitors convert ${EST.conv_multiplier} better than organic. ChatGPT referrals convert at ${EST.conv_chatgpt} vs Google organic ${EST.conv_google}.`, '&#128200;');
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(s.total_records)}</div><div class="lbl">Total Records</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(s.successful_records)}</div><div class="lbl">Successful</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(ts.total_triples_extracted)}</div><div class="lbl">Semantic Triples</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(gs.graph_count)}</div><div class="lbl">Citation Graphs</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(brandProfiles.length)}</div><div class="lbl">Brand Vector Profiles</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${fmt(biases.length)}</div><div class="lbl">Biases Detected</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${fmt(hs.length)}</div><div class="lbl">Hallucination Signals</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(recs.length)}</div><div class="lbl">Recommendations</div></div>`;
  h += '</div>';
  h += deepAnalysis(`    <strong>Pipeline:</strong> ${fmt(s.total_records)} records across ${s.attribution_stats?.unique_models||'-'} LLM models (${ragPct}% RAG-enabled). ${fmt(ts.total_triples_extracted)} triples extracted, ${fmt(ts.unique_triples)} unique. ${fmt(gs.graph_count)} citation graphs built.    <strong>Key Finding:</strong> ${Object.keys(bs).length} brands analyzed. ${EST.zero_click} of searches are zero-click; ${EST.aio_trigger} trigger AI Overviews. AI search converts ${EST.conv_multiplier} better than organic. The GEO market is ${EST.geo_market} (${EST.geo_cagr} CAGR), yet only ${EST.pct_measure} of marketers track AI citations &mdash; giving data-driven teams a major edge.  `);
  h += businessImpact('Estimated Business Impact Per Module', [    `<strong>Attribution Analysis:</strong> Identifies whether brand gaps are in RAG (fix: ${EST.one_time_seo}) or base weights (fix: ${EST.agency_monthly}). Wrong diagnosis costs 3-6 months of misallocated budget.`,    `<strong>SoMV:</strong> Each 10% SoMV gain = ${EST.pipeline_50m} additional AI-sourced pipeline for a \$50M ARR company. ChatGPT converts at ${EST.conv_chatgpt} (9x Google).`,    '<strong>Triple Extraction:</strong> Negative triples are active reputation threats. A single FAQ page can eliminate a false claim across all models. Pages over 20K chars get 4.3x more citations.',    `<strong>Citation Graphs:</strong> ${EST.top5_citation} of AI citations come from top 5 domains. ${EST.pct_third_party} from third-party sources. Getting into top 10 captures majority of referral value.`,    '<strong>Embedding Analysis:</strong> Low cosine similarity with ideal answer = content doesn\'t match what LLMs consider optimal. GEO-ready content discovered up to 10x faster.',    `<strong>Sentiment & Biases:</strong> Each HIGH bias costs ~\$50K/month in missed pipeline. ${EST.pct_enterprise_3plus} of enterprises run 3+ models; bias in one amplifies across all.`,    `<strong>Cost vs Agency:</strong> This tool replaces ${EST.agency_monthly} agency retainers. Total cost: ${EST.monthly_content} + tool usage = ~\$3K-\$8K/month.`  ]);
  h += sectionClose();
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 2: ATTRIBUTION ANALYSIS
// ══════════════════════════════════════════════════════════════
function renderSection2(s) {  const attr=s.attribution_stats||{};
const sm=s.somv||{};
const ragDist=attr.rag_brand_distribution||{};
const baseDist=attr.base_brand_distribution||{};
const allBrands=new Set([...Object.keys(ragDist),...Object.keys(baseDist)]);
const ragVsBase=sm.rag_vs_base||{};
const ragRatio=attr.total_responses?((attr.rag_enabled_count/attr.total_responses)*100).toFixed(0):'-';
  let h = sectionHeader(2, 'Attribution: RAG vs Base Weights', 'RAG-enabled (web search) vs base-weight (pre-trained knowledge) responses. Tells you if your brand gap is a web indexing problem or a model training problem.', '&#128269;');
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(attr.rag_enabled_count)}</div><div class="lbl">RAG-Enabled</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${fmt(attr.rag_disabled_count)}</div><div class="lbl">Base Weights Only</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(attr.unique_models)}</div><div class="lbl">Unique Models</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${ragRatio}%</div><div class="lbl">RAG Coverage</div></div>`;
  h += '</div>';
  h += deepAnalysis(`    <strong>RAG mode weak?</strong> Problem is web indexing. Fix: structured data (static HTML w/ schema = 94% parse success vs PDFs at 7%). FAQ schema +28% in 21 days, comparison tables +34% in 14 days. Cost: ${EST.one_time_seo}.    <strong>Base mode weak?</strong> Problem is pre-training authority. Fix: Wikipedia/Wikidata presence, PR campaigns, high-authority media. Cost: ${EST.agency_monthly}.    <strong>Key stat:</strong> Brand mentions correlate 3x more strongly than backlinks (r=0.664 vs 0.218). Pages under 3 months get 48% AI coverage vs 18% for 24+ months.  `);
  if(allBrands.size){    h += '<h3>RAG vs Base Brand Distribution</h3>';
  h += '<table class="res-table"><thead><tr><th>Brand</th><th>RAG Count</th><th>RAG %</th><th>Base Count</th><th>Base %</th><th>Total</th></tr></thead><tbody>';    [...allBrands].sort().forEach(b=>{      const rc=ragDist[b]||0;
const bc=baseDist[b]||0;
const tot=rc+bc;
const ragPct=attr.rag_enabled_count?((rc/attr.rag_enabled_count)*100).toFixed(1):'0.0';
const basePct=attr.rag_disabled_count?((bc/attr.rag_disabled_count)*100).toFixed(1):'0.0';
  h += `<tr${b==='Brand_A'?' class="brand-row"':''}><td><strong>${b}</strong></td><td>${fmt(rc)}</td><td>${ragPct}%</td><td>${fmt(bc)}</td><td>${basePct}%</td><td>${fmt(tot)}</td></tr>`;    });
  h += '</tbody></table>';  }
  if(ragVsBase.rag_enabled||ragVsBase.rag_disabled){    h += '<h3>SoMV: RAG-Enabled vs RAG-Disabled</h3><div class="res-grid2">';    [{label:'RAG-Enabled (Web Search ON)',data:ragVsBase.rag_enabled},     {label:'RAG-Disabled (Base Weights Only)',data:ragVsBase.rag_disabled}    ].forEach(({label,data})=>{      if(!data)return;
const dBrand=data.brand_stats||{};
  h += `<div><h4>${label} (${fmt(data.total)} responses)</h4>`;
  h += '<table class="res-table"><thead><tr><th>Brand</th><th>Mention Rate</th><th>Count</th></tr></thead><tbody>';      Object.entries(dBrand).sort((a,b)=>(b[1].mention_rate||0)-(a[1].mention_rate||0)).forEach(([br,st])=>{        h += `<tr${br==='Brand_A'?' class="brand-row"':''}><td>${br}</td><td>${pct(st.mention_rate)}</td><td>${fmt(st.mention_count)}</td></tr>`;      });
  h += '</tbody></table></div>';    });
  h += '</div>';  }
  h += businessImpact('Business Impact & Estimate', [    '<strong>% In RAG mode =</strong> If brand appears more in RAG, web presence is strong but pre-training needs work. Vice versa for base-mode dominance.',    `<strong>Fix cost:</strong> RAG issues = ${EST.one_time_seo} (structured data, schema). Base issues = ${EST.agency_monthly} (PR, Wikipedia, media).`,    `<strong>Revenue per RAG citation:</strong> ChatGPT referrals convert at ${EST.conv_chatgpt} (vs ${EST.conv_google} from Google). Each RAG citation ≈ 4.4x a traditional organic click.`,    '<strong>Content freshness:</strong> Pages under 3 months = 48% coverage. Pages over 24 months = 18%. Refresh stale pages first.'  ]);
  h += implGuide('Fix Attribution in 4 Weeks', [    'Week 1: Audit robots.txt for GPTBot, ClaudeBot, PerplexityBot, Google-Extended. Ensure crawlers are not blocked.',    'Week 1-2: Implement Schema.org on all key pages (Product, TechArticle, FAQPage). Add comparison tables (+34% in 14 days).',    'Week 2-3: Refresh all pages over 12 months old. Update stats, timestamps, add new data.',    'Week 3-4: For base-weight gaps: contribute to Wikipedia, claim Wikidata entity, target tech media. For RAG gaps: fix on-page SEO, add llm.txt file.'  ]);
  h += sectionClose();
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 3: SHARE OF MODEL VOICE (SoMV)// ══════════════════════════════════════════════════════════════
function renderSection3(s) {  const sm=s.somv||{};
const overall=sm.overall||{};
const bs=overall.brand_stats||{};
const ranking=overall.leadership_ranking||[];
const byModel=sm.by_model||{};
const byPersona=sm.by_persona||{};
const byTurn=sm.by_turn_type||{};
const byTurnIdx=sm.by_turn_index||{};
const cd=sm.citation_depth||{};
const omission=sm.omission_analysis||{};
const omissionRates=omission.omission_rates||{};
  let h = sectionHeader(3, 'Share of Model Voice (SoMV)', `Your brand visibility across all LLMs. Analogous to Share of Voice in traditional media, but for AI search. ChatGPT: ${EST.conv_chatgpt} conversion. Perplexity: 10.5%. Claude: 5%. Each point = real pipeline.`, '&#127919;');
  if(Object.keys(bs).length){    h += '<h3>Overall Brand Performance</h3>';
  h += '<table class="res-table"><thead><tr><th>Brand</th><th>SoMV</th><th>Mention Rate</th><th>Primary Rec Rate</th><th>Secondary</th><th>Omission</th><th>Total</th></tr></thead><tbody>';    Object.entries(bs).sort((a,b)=>(b[1].share_of_voice||0)-(a[1].share_of_voice||0)).forEach(([br,st])=>{      const barW=((st.share_of_voice||0)*100).toFixed(0);
const barColor=br==='Brand_A'?'var(--green)':br==='Competitor_B'?'var(--red)':'var(--blue)';
  h += `<tr${br==='Brand_A'?' class="brand-row"':''}><td><strong>${br}</strong></td><td><div style="display:flex;align-items:center;gap:6px"><div style="width:80px"><div class="res-bar"><div class="fill" style="width:${barW}%;background:${barColor}"></div></div></div><span>${pct(st.share_of_voice)}</span></div></td><td>${pct(st.mention_rate)}</td><td>${pct(st.primary_recommendation_rate)}</td><td>${fmt(st.secondary_mention_count)}</td><td>${pct(st.omission_rate)}</td><td>${fmt(st.mention_count)}</td></tr>`;    });
  h += '</tbody></table>';
  h += deepAnalysis('Primary Recommendation Rate is the most important metric: how often your brand is #1. Omission rate >20% means LLMs frequently ignore your brand. Target: >50% primary rec, <10% omission, >80% mention rate.');  }
  if(ranking.length){    h += '<h3>Leadership Ranking</h3><div class="res-kpi-row">';    ranking.forEach(([br,st],i)=>{      const medal=i===0?'&#127942;':i===1?'&#129352;':i===2?'&#129353;':'';
  h += `<div class="res-kpi"><div class="val" style="color:${i===0?'var(--green)':i===1?'var(--blue)':'var(--text3)'}">${medal} ${pct(st.share_of_voice)}</div><div class="lbl">${br}</div></div>`;    });
  h += '</div>';  }
  if(Object.keys(byModel).length){    h += '<h3>SoMV by LLM Model</h3>';
const modelBrands=new Set();Object.values(byModel).forEach(d=>Object.keys(d.brand_stats||{}).forEach(b=>modelBrands.add(b)));
  h += '<table class="res-table"><thead><tr><th>Model</th><th>Responses</th>';    [...modelBrands].sort().forEach(b=>{h += `<th>${b} SoMV</th><th>${b} Mention</th>`});
  h += '</tr></thead><tbody>';    Object.entries(byModel).sort((a,b)=>b[1].total-a[1].total).forEach(([m,d])=>{      h += `<tr><td><strong>${m}</strong></td><td>${fmt(d.total)}</td>`;      [...modelBrands].sort().forEach(b=>{        const st=(d.brand_stats||{})[b]||{};
  h += `<td>${pct(st.share_of_voice)}</td><td>${pct(st.mention_rate)}</td>`;      });
  h += '</tr>';    });
  h += '</tbody></table>';  }
  if(Object.keys(byPersona).length){    h += '<h3>SoMV by Buyer Persona</h3>';
const personaBrands=new Set();Object.values(byPersona).forEach(d=>Object.keys(d.brand_stats||{}).forEach(b=>personaBrands.add(b)));
  h += '<table class="res-table"><thead><tr><th>Persona</th><th>Responses</th>';    [...personaBrands].sort().forEach(b=>{h += `<th>${b} SoMV</th>`});
  h += '</tr></thead><tbody>';    Object.entries(byPersona).forEach(([p,d])=>{      h += `<tr><td><strong>${p.replace(/_/g,' ')}</strong></td><td>${fmt(d.total)}</td>`;      [...personaBrands].sort().forEach(b=>{        h += `<td>${pct((d.brand_stats||{})[b]?.share_of_voice)}</td>`;      });
  h += '</tr>';    });
  h += '</tbody></table>';  }
  if(Object.keys(byTurn).length){    h += '<h3>SoMV by Conversation Turn Type</h3>';
const turnBrands=new Set();Object.values(byTurn).forEach(d=>Object.keys(d.brand_stats||{}).forEach(b=>turnBrands.add(b)));
  h += '<table class="res-table"><thead><tr><th>Turn Type</th><th>Responses</th>';    [...turnBrands].sort().forEach(b=>{h += `<th>${b} SoMV</th>`});
  h += '</tr></thead><tbody>';    Object.entries(byTurn).forEach(([t,d])=>{      h += `<tr><td><strong>${t.replace(/_/g,' ')}</strong></td><td>${fmt(d.total)}</td>`;      [...turnBrands].sort().forEach(b=>{        h += `<td>${pct((d.brand_stats||{})[b]?.share_of_voice)}</td>`;      });
  h += '</tr>';    });
  h += '</tbody></table>';
  h += deepAnalysis('Citation Decay: 44.2% of AI citations come from first 30% of text. Pages over 20K chars get 4.3x more citations than pages under 500 chars. Create deep-dive content for later conversation stages.');  }
  if(cd.avg_citations_per_response!=null){    h += '<h3>Citation Depth</h3>';
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${cd.avg_citations_per_response.toFixed(2)}</div><div class="lbl">Avg Citations/Response</div></div>`;
const dist=cd.citation_distribution||{};    Object.entries(dist).forEach(([k,v])=>{      h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(v)}</div><div class="lbl">${k.replace(/_/g,' ')}</div></div>`;    });
  h += '</div>';
const topDomains=cd.top_cited_domains||{};
  if(Object.keys(topDomains).length){      h += '<h4>Top Cited Domains</h4>';
const totalCitations=Object.values(topDomains).reduce((a,b)=>a+b,0);
  h += '<table class="res-table"><thead><tr><th>Domain</th><th>Citations</th><th>Share</th></tr></thead><tbody>';      Object.entries(topDomains).sort((a,b)=>b[1]-a[1]).forEach(([dom,cnt])=>{        h += `<tr><td><strong>${dom}</strong></td><td>${fmt(cnt)}</td><td>${((cnt/totalCitations)*100).toFixed(1)}%</td></tr>`;      });
  h += '</tbody></table>';
  h += deepAnalysis(`Top 5 domains capture ${EST.top5_citation} of all AI citations; top 20 capture 66%. ${EST.pct_third_party} are from third-party sources. Reddit saw ${EST.reddit_growth} growth in AI citations.`);    }  }
  if(Object.keys(omissionRates).length){    h += '<h3>Omission Analysis: Where You\'re Invisible</h3>';
  h += '<table class="res-table"><thead><tr><th>Brand</th><th>Omitted</th><th>Rate</th><th>Visibility Score</th></tr></thead><tbody>';    Object.entries(omissionRates).forEach(([br,st])=>{      const vis=100-(st.omission_rate*100);
const visColor=vis>80?'var(--green)':vis>50?'var(--yellow)':'var(--red)';
  h += `<tr${br==='Brand_A'?' class="brand-row"':''}><td><strong>${br}</strong></td><td>${fmt(st.omitted_count)}</td><td>${pct(st.omission_rate)}</td><td><div style="display:flex;align-items:center;gap:6px"><div style="width:60px"><div class="res-bar"><div class="fill" style="width:${vis}%;background:${visColor}"></div></div></div><span>${vis.toFixed(1)}%</span></div></td></tr>`;    });
  h += '</tbody></table>';  }
  h += businessImpact('Business Impact & Estimate', [    `<strong>Every 10% SoMV gain</strong> ≈ ${EST.pipeline_50m} additional AI-sourced pipeline for \$50M ARR company. ChatGPT converts at ${EST.conv_chatgpt} (9x Google).`,    '<strong>Omission = direct revenue loss:</strong> 30% omission = 30% of buyers never hear your name. At \$50K deal size, that\'s ~\$1.5M/month invisible pipeline.',    '<strong>Model-specific gaps:</strong> Low Perplexity SoMV = missing research-heavy buyers (780M monthly queries, 10.5% conversion). Low Claude = missing enterprise segment (70% of enterprise deals).',    '<strong>Content length:</strong> Pages over 20K chars get 4.3x more citations. Short-form content is penalized in AI search.'  ]);
  h += implGuide('Improve SoMV in 90 Days', [    'Month 1: Fix weakest model/persona/turn-type. Create deep-dive content (20K+ chars). Front-load claims in first 30% of text.',    `Month 2: Target omission-heavy models. Get cited on Reddit (+${EST.reddit_growth} growth), YouTube, G2. Implement comparison tables (+34% in 14 days).`,    'Month 3: Brand mention campaign (3x more valuable than backlinks). Target community platforms. Monitor 6 AI crawlers.',    'Ongoing: Re-run analysis monthly. Track crawler access (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended, Bingbot).'  ]);
  h += sectionClose();
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 4: TRIPLE EXTRACTION// ══════════════════════════════════════════════════════════════
function renderSection4(s) {  const ts=s.triple_stats||{};
const sentDist=ts.sentiment_distribution||{};
const triplesByBrand=ts.triples_by_brand||{};
const topPred=ts.top_predicates||[];
const topObj=ts.top_objects||[];
const negTriples=ts.negative_triples_brand_a||[];
const posTriples=ts.positive_triples_brand_a||[];
  let h = sectionHeader(4, 'Triple Extraction: What LLMs Say About You', 'Every LLM response is broken into (Subject, Predicate, Object) claims. This reveals the exact knowledge graph LLMs have built about your brand.', '&#128221;');
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(ts.total_triples_extracted)}</div><div class="lbl">Total Triples</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(ts.unique_triples)}</div><div class="lbl">Unique Patterns</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${tag(ts.extraction_method||'-','purple')}</div><div class="lbl">Method</div></div>`;
  h += '</div>';
  h += deepAnalysis(`    <strong>What triples tell you:</strong> "Brand_A supports SOC2" is a triple. Thousands of triples form the knowledge graph LLMs use to answer buyer questions. Sparse or negative triples = LLMs recommend competitors.    <strong>GEO tactics that work:</strong> Quotation addition (+40.6% visibility), statistics (+32.8%), source citation (+29.7%), authoritative voice (+25.3%). Keyword stuffing and padding have NEGATIVE effects.  `);
  if(Object.keys(sentDist).length){    const totalSent=Object.values(sentDist).reduce((a,b)=>a+b,0);
  h += '<h3>Triple Sentiment Distribution</h3>';
  h += '<div class="res-kpi-row">';    Object.entries(sentDist).forEach(([k,v])=>{      const col=k==='positive'?'var(--green)':k==='negative'?'var(--red)':k==='comparative'?'var(--purple)':'var(--blue)';
  h += `<div class="res-kpi"><div class="val" style="color:${col}">${fmt(v)}</div><div class="lbl">${k} (${totalSent?((v/totalSent)*100).toFixed(1):'0'}%)</div></div>`;    });
  h += '</div>';
  h += deepAnalysis('Healthy profile: 45-55% positive, 5-15% negative, 10-20% neutral, 15-25% comparative. Negative >15% = systematic reputation problem. Positive:negative ratio should be at least 3:1.');  }
  if(Object.keys(triplesByBrand).length){    h += '<h3>Triples by Brand</h3>';
  h += '<table class="res-table"><thead><tr><th>Brand</th><th>Total</th><th>Positive</th><th>Negative</th><th>Neutral</th><th>Comparative</th><th>Pos Rate</th><th>Neg Rate</th></tr></thead><tbody>';    Object.entries(triplesByBrand).sort((a,b)=>(b[1].count||0)-(a[1].count||0)).forEach(([br,st])=>{      const posR=st.count?((st.positive/st.count)*100).toFixed(1):'0.0';
const negR=st.count?((st.negative/st.count)*100).toFixed(1):'0.0';
  h += `<tr${br==='Brand_A'?' class="brand-row"':''}><td><strong>${br}</strong></td><td>${fmt(st.count)}</td><td style="color:var(--green)">${fmt(st.positive)}</td><td style="color:var(--red)">${fmt(st.negative)}</td><td>${fmt(st.neutral)}</td><td style="color:var(--purple)">${fmt(st.comparative)}</td><td>${posR}%</td><td style="color:${parseFloat(negR)>5?'var(--red)':''}">${negR}%</td></tr>`;    });
  h += '</tbody></table>';  }
  if(topPred.length){    h += '<h3>Top Predicates</h3>';
const maxP=topPred[0]?.[1]||1;
  h += '<table class="res-table"><thead><tr><th>#</th><th>Predicate</th><th>Count</th></tr></thead><tbody>';    topPred.slice(0,15).forEach(([p,c],i)=>{      h += `<tr><td>${i+1}</td><td><strong>${p}</strong></td><td>${fmt(c)}</td></tr>`;    });
  h += '</tbody></table>';  }
  if(topObj.length){    h += '<h3>Top Objects</h3>';
  h += '<table class="res-table"><thead><tr><th>#</th><th>Object</th><th>Count</th></tr></thead><tbody>';    topObj.slice(0,10).forEach(([o,c],i)=>{      h += `<tr><td>${i+1}</td><td>${o}</td><td>${fmt(c)}</td></tr>`;    });
  h += '</tbody></table>';  }
  if(negTriples.length){    const uniqueNeg=[...new Map(negTriples.map(t=>[`${t.subject}|${t.predicate}|${t.object}`,t])).values()];
  h += `<h3>Negative Claims About Brand_A (${uniqueNeg.length} unique, ${negTriples.length} total)</h3>`;    uniqueNeg.slice(0,10).forEach(t=>{      h += `<div class="res-insight danger"><strong>${t.subject}</strong> <span style="color:var(--red)">${t.predicate}</span> <strong>${t.object}</strong><div class="res-quote">"${t.sentence}"</div></div>`;    });  }
  if(posTriples.length){    const uniquePos=[...new Map(posTriples.map(t=>[`${t.subject}|${t.predicate}|${t.object}`,t])).values()];
  h += `<h3>Positive Claims About Brand_A (${uniquePos.length} unique, ${posTriples.length} total)</h3>`;    uniquePos.slice(0,10).forEach(t=>{      h += `<div class="res-insight success"><strong>${t.subject}</strong> <span style="color:var(--green)">${t.predicate}</span> <strong>${t.object}</strong><div class="res-quote">"${t.sentence}"</div></div>`;    });  }
  h += businessImpact('Business Impact & Estimate', [    '<strong>Negative triples = direct reputation damage:</strong> A single negative triple seen by a buyer researching via AI (67% do) can kill a deal before you know it exists.',    '<strong>Fix cost per triple:</strong> A targeted FAQ page costs ~\$500-\$1,000 to create. FAQ schema yields +28% coverage in 21 days. Each fixed negative triple protects \$50K+ in pipeline.',    '<strong>Princeton/KDD tactics:</strong> Quote addition +40.6%, statistics +32.8%, source citation +29.7%. Structured formatting makes LLMs 28-40% more likely to cite your content.',    '<strong>Content depth:</strong> Pages over 20K chars = 4.3x more citations. 44.2% of citations come from first 30% of text. Structure key claims in opening sections.'  ]);
  h += implGuide('Fix Triples in 6 Weeks', [    'Week 1: Audit all negative triples. Verify true vs false claims. Create documentation for each false claim with Schema.org markup.',    'Week 2-3: Create FAQ pages for top 5 negative claims. Add statistics (+32.8%), quotes (+40.6%), authoritative voice (+25.3%).',    'Week 3-4: Reinforce positive triples with case studies, benchmarks, third-party validation on G2, Gartner, Capterra.',    'Week 4-6: Create structured comparison tables for comparative triples (+34% coverage in 14 days). Expand key pages to 20K+ chars.',    'Goal: Reduce negative triples by 50% in 6 months. Maintain 3:1 positive:negative ratio.'  ]);
  h += sectionClose();
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 5: CITATION GRAPHS// ══════════════════════════════════════════════════════════════
function renderSection5(s) {  const gs=s.graph_stats||{};
const graphs=gs.graphs||{};
const missing=gs.missing_authority_nodes||[];
const compDom=gs.competitor_dominant_sources||[];
  let h = sectionHeader(5, 'Citation Graph Construction', 'Network maps showing citation flows between LLMs, brands, and source domains. Reveals which sources control your AI search narrative.', '&#128279;');
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(gs.graph_count)}</div><div class="lbl">Citation Graphs</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${fmt(missing.length)}</div><div class="lbl">Missing Authority Nodes</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${fmt(compDom.length)}</div><div class="lbl">Competitor-Dominant Sources</div></div>`;
  h += '</div>';
  h += deepAnalysis(`    <strong>Citation power law:</strong> Top 5 domains = ${EST.top5_citation} of citations. Top 10 = ${EST.top10_citation}. Top 20 = 66%. Getting into the top 10 captures majority of value.    <strong>${EST.pct_third_party} of AI citations come from third parties.</strong> Only ~15% from brand-owned sites. Brand mentions (not just backlinks) correlate 3x more strongly with citations (r=0.664 vs 0.218).    <strong>Platform sourcing:</strong> ChatGPT → Wikipedia (7.8%), Reddit (1.8%). Google AIO → Reddit (2.2%), YouTube (1.9%). Perplexity → Reddit (6.6%), YouTube, G2, LinkedIn. Claude → NYT, The Atlantic, New Yorker.  `);
  if(Object.keys(graphs).length){    h += '<h3>Graph Metrics</h3>';
  h += '<table class="res-table"><thead><tr><th>Graph</th><th>Nodes</th><th>Edges</th><th>Density</th><th>Components</th></tr></thead><tbody>';    Object.entries(graphs).forEach(([name,data])=>{      h += `<tr><td><strong>${name.replace(/_/g,' ')}</strong></td><td>${fmt(data.nodes)}</td><td>${fmt(data.edges)}</td><td>${(data.density||0).toFixed(4)}</td><td>${fmt(data.components)}</td></tr>`;    });
  h += '</tbody></table>';  }
  if(missing.length){    h += '<h3>Missing Authority Nodes</h3>';    missing.slice(0,10).forEach(n=>{h += insight(`<strong>${n}</strong> &mdash; Referenced by LLMs but no brand presence. ${EST.pct_third_party} of citations are third-party &mdash; establish presence here for significant citation volume.`, 'danger')});  }
  if(compDom.length){    h += '<h3>Competitor-Dominant Sources</h3>';    compDom.slice(0,5).forEach(s=>{h += insight(`<strong>${s}</strong> &mdash; Competitor-dominated. Focus on mention-building (3x more valuable than backlinks).`, 'warn')});  }
  h += businessImpact('Business Impact & Estimate', [    '<strong>Top 5 domains = 38% of citations.</strong> One positive mention on a top-5 source is worth 100 mentions on low-authority blogs.',    '<strong>Mention building > link building:</strong> Brand mentions correlate 3x stronger than backlinks. A Reddit mention without a link beats a backlink from a low-authority blog.',    `<strong>Competitor intelligence:</strong> If competitors dominate Reddit (+${EST.reddit_growth} growth) or YouTube, you need a strategy for those platforms.`,    '<strong>Content depth → stronger edges:</strong> Pages over 20K chars get 4.3x more citations. Front-loaded content creates stronger citation graph edges.',    `<strong>Platform-specific strategy needed:</strong> Each LLM has different citation sources. One-size-fits-all no longer works with ${EST.pct_enterprise_3plus} running 3+ models.`  ]);
  h += implGuide('Build Citation Graph Authority', [    `Week 1: Map missing authority nodes. Prioritize by citation weight. Target Reddit (+${EST.reddit_growth}), YouTube, G2.`,    'Week 1-2: Implement structured data (FAQ: +28%, comparison tables: +34%, llm.txt: +32%). Use static HTML (94% parse) not JS (23%) or PDFs (7%).',    'Week 2-4: Target top 5 competitor-dominant sources. Create brand mentions (not just links) on Reddit, Stack Overflow, Hacker News.',    'Month 2: Create deep-dive content (20K+ chars = 4.3x more citations). Build authority hubs in under-connected graph components.',    'Monthly: Re-run graph analysis. Track new authority nodes. Monitor 6 AI crawler access.'  ]);
  h += sectionClose();
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 6: EMBEDDING & SEMANTIC ANALYSIS// ══════════════════════════════════════════════════════════════
function renderSection6(s) {  const emb=s.embedding_analysis||{};
const bvp=emb.brand_vector_profiles||{};
const crossSim=emb.cross_model_similarity||{};
const drift=emb.semantic_drift||[];
const topicEmb=emb.topic_embeddings||{};
const textStats=emb.text_statistics||{};
const clusters=emb.embedding_clusters||[];
  let h = sectionHeader(6, 'Embedding & Semantic Vector Analysis', 'Measures how closely your brand content aligns with what LLMs consider the "ideal" answer. Semantic drift = your content isn\'t answering what LLMs think buyers are asking.', '&#129504;');
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${tag(emb.model_used||'-','blue')}</div><div class="lbl">Embedding Model</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(emb.total_responses_analyzed)}</div><div class="lbl">Responses Analyzed</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(Object.keys(bvp).length)}</div><div class="lbl">Brand Vector Profiles</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${fmt(clusters.length)}</div><div class="lbl">UMAP Clusters</div></div>`;
  h += '</div>';
  h += deepAnalysis(`    <strong>Intra-similarity</strong> (>0.8 = high): measures consistency across LLM descriptions. Low = models have conflicting info about your brand. Consistency is essential with ${EST.pct_enterprise_3plus} running 3+ models.    <strong>Conversion impact:</strong> ChatGPT converts at ${EST.conv_chatgpt}, Perplexity at 10.5%, Claude at 5%. Low alignment with ChatGPT's ideal answer means missing the highest-converting traffic source.  `);
  if(Object.keys(bvp).length){    h += '<h3>Brand Vector Profiles</h3>';
  h += '<table class="res-table"><thead><tr><th>Brand</th><th>Chunks</th><th>Intra-Similarity</th><th>Consistency</th></tr></thead><tbody>';    Object.entries(bvp).sort((a,b)=>(b[1].mean_intra_similarity||0)-(a[1].mean_intra_similarity||0)).forEach(([br,prof])=>{      const consistency=prof.mean_intra_similarity>0.8?'High':prof.mean_intra_similarity>0.6?'Medium':'Low';
const consColor=consistency==='High'?'var(--green)':consistency==='Medium'?'var(--yellow)':'var(--red)';
  h += `<tr${br==='Brand_A'?' class="brand-row"':''}><td><strong>${br}</strong></td><td>${fmt(prof.num_chunks)}</td><td>${(prof.mean_intra_similarity||0).toFixed(4)}</td><td><span style="color:${consColor};font-weight:600">${consistency}</span></td></tr>`;    });
  h += '</tbody></table>';  }
  if(Object.keys(crossSim).length){    h += '<h3>Cross-Model Semantic Similarity</h3>';
  h += '<table class="res-table"><thead><tr><th>Model Pair</th><th>Cosine Similarity</th><th>Interpretation</th></tr></thead><tbody>';    Object.entries(crossSim).sort((a,b)=>(b[1].cosine_similarity||0)-(a[1].cosine_similarity||0)).forEach(([pair,data])=>{      const sim=data.cosine_similarity||0;
const simColor=sim>0.95?'var(--green)':sim>0.9?'var(--blue)':sim>0.8?'var(--yellow)':'var(--red)';
  h += `<tr><td><strong>${pair.replace(/_vs_/g,' vs ')}</strong></td><td><span style="color:${simColor};font-weight:700">${(sim*100).toFixed(2)}%</span></td><td>${data.interpretation||'-'}</td></tr>`;    });
  h += '</tbody></table>';  }
  if(drift.length){    h += '<h3>Semantic Drift</h3>';    drift.slice(0,8).forEach(d=>{      const severity=d.drift_score>0.15?'danger':d.drift_score>0.08?'warn':'success';
  h += insight(`<strong>${d.brand_a_vs}</strong> &mdash; Cosine: ${(d.cosine_similarity||0).toFixed(4)} | Drift: ${(d.drift_score||0).toFixed(4)} | ${d.interpretation||'-'}`, severity);    });  }
  if(textStats.total_responses){    h += '<h3>Response Text Statistics</h3>';
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(textStats.total_responses)}</div><div class="lbl">Total Responses</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(textStats.avg_response_length?.toFixed(0))}</div><div class="lbl">Avg Length (chars)</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(textStats.median_response_length?.toFixed(0))}</div><div class="lbl">Median Length</div></div>`;
  h += '</div>';
  h += deepAnalysis('If your content is shorter than the average LLM response length, you\'re at a structural disadvantage. Pages over 20K chars get 4.3x more citations. Match or exceed the average with comprehensive documentation.');  }
  h += businessImpact('Business Impact & Estimate', [    `<strong>Low cosine similarity</strong> with ideal answer = content doesn't match LLM expectations. ChatGPT (${EST.conv_chatgpt} conversion) won't recommend you. Every % alignment improvement = higher conversion.`,    `<strong>Low intra-similarity</strong> = LLMs have inconsistent info about you. Leads to unpredictable AI search behavior. ${EST.pct_enterprise_3plus} run 3+ models; consistency matters.`,    '<strong>High drift</strong> = your perceived positioning doesn\'t match reality. GEO-ready content is discovered 10x faster. Drift reduction is highest-ROI content investment.',    '<strong>Content length:</strong> Pages over 20K chars get 4.3x more citations. If your avg content is shorter than LLM response length, expansion is top priority.'  ]);
  h += implGuide('Fix Semantic Alignment', [    `Week 1: Compare your brand centroid vs ideal answer for top 10 buyer queries. Prioritize high-converting queries (ChatGPT: ${EST.conv_chatgpt}).`,    'Week 2-3: Rewrite pages with ideal answer terminology. Use structured formatting (28-40% more citations). Front-load claims (44.2% from first 30%).',    `Week 3-4: Audit messaging consistency across all public content. Essential for ${EST.pct_enterprise_3plus} running 3+ models.`,    'Month 2: Expand key pages to 10K+ chars (20K+ for flagship). Target >0.8 intra-similarity within 6 months.'  ]);
  h += sectionClose();
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 7: SENTIMENT & HALLUCINATION// ══════════════════════════════════════════════════════════════
function renderSection7(s) {  const sent=s.sentiment_matrix||{};
const smSum=sent.sentiment_summary||{};
const bsm=sent.brand_sentiment_matrix||{};
const msm=sent.model_sentiment_matrix||{};
const tse=sent.turn_sentiment_evolution||{};
const npc=sent.negative_pattern_clusters||[];
  let h = sectionHeader(7, 'Sentiment & Hallucination Matrix', 'Brand sentiment across all LLMs + hallucination detection. 67% of enterprise buyers research via AI before meeting vendors. Sentiment IS your first impression.', '&#128172;');
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(sent.total_analyzed)}</div><div class="lbl">Responses Analyzed</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(sent.detected_biases?.length||0)}</div><div class="lbl">Biases Detected</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${fmt(sent.hallucination_signals?.length||0)}</div><div class="lbl">Hallucination Signals</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(npc.length)}</div><div class="lbl">Negative Patterns</div></div>`;
  h += '</div>';
  h += deepAnalysis(`    <strong>What sentiment scores mean:</strong> Negative score = the evidence LLMs access skews negative. Fixable by publishing positive, well-structured content.    <strong>Conversion stakes:</strong> ChatGPT converts at ${EST.conv_chatgpt} (9x Google). Perplexity: 10.5%. Claude: 5%. Negative sentiment doesn't just lose a click &mdash; it loses a 4.4x higher-converting visitor.    <strong>Zero-click reality:</strong> ${EST.zero_click} of searches = zero clicks. ${EST.aio_trigger} trigger AI Overviews. When AI summaries present, users click links in only 8% of visits. LLM sentiment IS your brand impression.  `);
  if(smSum.most_positively_perceived){    h += '<h3>Sentiment Rankings</h3>';
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${smSum.most_positively_perceived}</div><div class="lbl">Most Positive Perception</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${smSum.most_negatively_perceived}</div><div class="lbl">Most Negative Perception</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">#${smSum.brand_a_sentiment_rank||'-'}</div><div class="lbl">Brand_A Rank</div></div>`;
  h += '</div>';  }
  if(Object.keys(bsm).length){    h += '<h3>Brand Sentiment Matrix</h3>';
  h += '<table class="res-table"><thead><tr><th>Brand</th><th>Positive Rate</th><th>Negative Rate</th><th>Neutral Rate</th><th>Compound</th></tr></thead><tbody>';    Object.entries(bsm).forEach(([br,st])=>{      h += `<tr${br==='Brand_A'?' class="brand-row"':''}><td><strong>${br}</strong></td><td style="color:var(--green)">${pct(st.positive_rate)}</td><td style="color:var(--red)">${pct(st.negative_rate)}</td><td>${pct(st.neutral_rate)}</td><td>${(st.compound_score||0).toFixed(3)}</td></tr>`;    });
  h += '</tbody></table>';  }
  if(Object.keys(msm).length){    h += '<h3>Sentiment by Model</h3>';
const sentBrands=new Set();Object.values(msm).forEach(d=>Object.keys(d).forEach(b=>sentBrands.add(b)));
  h += '<table class="res-table"><thead><tr><th>Model</th>';    [...sentBrands].sort().forEach(b=>{h += `<th>${b} Pos</th><th>${b} Neg</th>`});
  h += '</tr></thead><tbody>';    Object.entries(msm).forEach(([m,d])=>{      h += `<tr><td><strong>${m}</strong></td>`;      [...sentBrands].sort().forEach(b=>{        const st=d[b]||{};
  h += `<td style="color:var(--green)">${pct(st.positive_rate)}</td><td style="color:var(--red)">${pct(st.negative_rate)}</td>`;      });
  h += '</tr>';    });
  h += '</tbody></table>';  }
  if(npc.length){    h += '<h3>Negative Pattern Clusters</h3>';    Object.values(npc).flat().forEach(cluster=>{      const models=(cluster.models||[]).join(', ');
const examples=(cluster.examples||[]).slice(0,2);
  h += `<div class="res-insight danger" style="margin-bottom:8px">        <strong>${cluster.brand}</strong> &mdash; <code>${cluster.pattern}</code> (${cluster.count} occurrences)        <div style="font-size:.72em;color:var(--text2);margin-top:2px">Models: ${models}</div>        ${examples.map(e=>`<div class="res-quote">${e.substring(0,200)}${e.length>200?'...':''}</div>`).join('')}      </div>`;    });  }
  h += businessImpact('Business Impact & Estimate', [    `<strong>67% of enterprise buyers</strong> research via AI before first vendor meeting. ChatGPT converts at ${EST.conv_chatgpt} (9x Google). Losing a ChatGPT recommendation = losing your highest-converting lead source.`,    `<strong>Hallucinations = active pipeline damage:</strong> ${EST.zero_click} zero-click rate means hallucinations go unchallenged in 92% of cases (when users don't click links).`,    '<strong>Sentiment trajectory:</strong> Improving sentiment across conversation turns = strong documentation. Degrading sentiment = surface content strong but deep docs weak.',    '<strong>Content freshness advantage:</strong> Pages under 3 months get 48% coverage vs 18% for 24+ months. Fresh counter-narrative can displace negative sentiment within weeks.',    '<strong>Cost per hallucination fix:</strong> Create definitive documentation (~$500-$1K), add FAQ schema (+28% in 21 days), submit for indexing.'  ]);
  h += implGuide('Fix Sentiment in 8 Weeks', [    'Week 1: Emergency fix for hallucinations. Create definitive documentation countering each false claim. Add FAQPage schema (+28% in 21 days).',    'Week 2-4: For each negative pattern, publish case studies, testimonials. Use quotes (+40.6%), statistics (+32.8%), authoritative voice (+25.3%).',    'Week 4-6: Model-specific intervention. ChatGPT: Wikipedia/Reddit. Claude: editorial media. Perplexity: Reddit/YouTube/G2.',    'Week 6-8: Set up weekly sentiment tracking. Alerts for drops >10 percentage points. Quarterly content freshness audits.',    'Goal: Eliminate all HIGH biases in 3 months. Reduce negative triples by 50% in 6 months.'  ]);
  h += sectionClose();
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 8: DETECTED BIASES// ══════════════════════════════════════════════════════════════
function renderSection8(s) {  const sent=s.sentiment_matrix||{};
const biases=sent.detected_biases||[];
const hs=sent.hallucination_signals||[];
const smSum=sent.sentiment_summary||{};
  if(!biases.length&&!hs.length) return '';
  let h = sectionHeader(8, 'Detected Biases & Hallucination Patterns', 'Systematic patterns where LLMs portray your brand inaccurately. These are active reputation threats that directly impact pipeline.', '&#9888;');
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${biases.filter(b=>b.severity==='HIGH').length}</div><div class="lbl">HIGH Severity</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${biases.filter(b=>b.severity==='MEDIUM').length}</div><div class="lbl">MEDIUM Severity</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${biases.filter(b=>b.severity==='LOW').length}</div><div class="lbl">LOW Severity</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${hs.length}</div><div class="lbl">Hallucination Signals</div></div>`;
  h += '</div>';
  h += deepAnalysis(`    <strong>Bias types:</strong> Vendor lock-in (competitor favored for market presence), Outdated info (old claims), Steep learning curve (assumed complexity), Performance issues (unverified complaints). Each type requires a different response.    <strong>Multi-model amplification:</strong> Same bias across ChatGPT (53.9% share), Google AIO (2B impressions), and Claude (9.2%, 70% enterprise deals) creates a confirmation loop affecting 80%+ of AI touchpoints.    <strong>Conversion impact:</strong> AI search converts ${EST.conv_multiplier} better than organic. Each biased response costs ~4.4x more than a biased Google result.  `);
  if(biases.length){    h += '<h3>All Detected Biases</h3>';
  h += '<table class="res-table"><thead><tr><th>Brand</th><th>Pattern</th><th>Severity</th><th>Occurrences</th><th>Remediation</th></tr></thead><tbody>';    biases.sort((a,b)=>{const s={HIGH:0,MEDIUM:1,LOW:2};return(s[a.severity]||3)-(s[b.severity]||3)||b.occurrence_count-a.occurrence_count}).forEach(b=>{      const sevCls=b.severity==='HIGH'?'high':b.severity==='MEDIUM'?'med':'low';
  h += `<tr><td><strong>${b.brand}</strong></td><td>${b.pattern_display||b.bias_pattern}</td><td>${tag(b.severity,sevCls)}</td><td>${fmt(b.occurrence_count)}</td><td style="font-size:.78em;color:var(--text2)">${b.remediation||'-'}</td></tr>`;    });
  h += '</tbody></table>';
const critical=smSum.critical_biases||[];
  if(critical.length){      h += '<h3>Critical Biases (Highest Impact)</h3>';      critical.forEach(b=>{        h += `<div class="res-insight danger"><strong>${b.brand}</strong> &mdash; ${b.pattern_display} ${tag(b.severity,'high')} (${b.occurrence_count} occurrences)<div style="font-size:.78em;color:var(--text2);margin-top:3px"><strong>Fix:</strong> ${b.remediation}</div></div>`;      });    }  }
  if(hs.length){    h += '<h3>Hallucination Signals</h3>';    hs.forEach(hh=>{      h += `<div class="res-insight warn"><strong>${hh.brand}</strong> &mdash; ${hh.claim_type} ${tag(hh.confidence,'blue')} (${hh.occurrence_count} occurrences)<div style="font-size:.78em;color:var(--text2);margin-top:3px"><strong>Conflicts:</strong> ${(hh.conflicting_claims||[]).join('; ')}</div><div style="font-size:.78em;color:var(--text2)"><strong>Action:</strong> ${hh.action||'-'}</div></div>`;    });  }
  h += businessImpact('Business Impact & Estimate', [    `<strong>Each HIGH severity bias</strong> affects thousands of monthly queries. At ${EST.conv_multiplier}x organic conversion value, each biased response costs ~4.4x more than a biased Google result.`,    '<strong>Enterprise deal impact:</strong> 23% of enterprise deals stall or are lost due to negative AI search findings. Claude wins 70% of enterprise deals.',    '<strong>Legal risk:</strong> Hallucinated claims about security breaches, compliance failures create legal exposure. False claims propagate faster than traditional misinformation.',    '<strong>Multi-platform amplification:</strong> Same bias across ChatGPT (53.9%), Google AIO, and Claude creates a confirmation loop affecting 80%+ of AI touchpoints.',    '<strong>Fix speed:</strong> Claude cites freshest content (median 5.1 months). Fresh corrective content can displace biases within weeks on Claude, months on ChatGPT (median 8 months).'  ]);
  h += implGuide('Eliminate Biases', [    'Day 1-3: Emergency hallucination response. Create definitive documentation, add FAQ schema (+28% in 21 days), submit for indexing.',    'Week 1: Document audit for each bias. Create countering content with quotes (+40.6%), statistics (+32.8%), authoritative voice (+25.3%).',    `Week 2-4: Third-party validation. Get benchmarks, case studies on G2, Gartner, Capterra. ${EST.pct_third_party} of citations are third-party.`,    `Month 2: Wikipedia/Wikidata corrections. Wikipedia pruning ${EST.wikipedia_prune} means quality matters. ChatGPT's #1 source (7.8%).`,    'Goal: Eliminate all HIGH biases in 3 months. Reduce total bias mentions by 50% in 6 months.'  ]);
  h += sectionClose();
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 9: RECOMMENDATIONS// ══════════════════════════════════════════════════════════════
function renderSection9(s) {  const recs=s.recommendations||[];
  if(!recs.length) return '';
  let h = sectionHeader(9, 'Strategic Recommendations', `Prioritized by business impact. Derived from the ${EST.geo_market} GEO market (${EST.geo_cagr} CAGR). AI search converts ${EST.conv_multiplier} better than organic. ChatGPT converts at ${EST.conv_chatgpt}.`, '&#128161;');
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${recs.filter(r=>r.priority==='HIGH').length}</div><div class="lbl">High Priority</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${recs.filter(r=>r.priority==='MEDIUM').length}</div><div class="lbl">Medium Priority</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${recs.filter(r=>r.priority==='LOW').length}</div><div class="lbl">Low Priority</div></div>`;
  h += '</div>';  recs.sort((a,b)=>{const p={HIGH:0,MEDIUM:1,LOW:2};return(p[a.priority]||3)-(p[b.priority]||3)}).forEach((r,i)=>{    const cls=r.priority==='HIGH'?'danger':r.priority==='MEDIUM'?'warn':'success';
const pillCls=r.priority==='HIGH'?'high':r.priority==='MEDIUM'?'med':'low';
  h += `<div class="res-insight ${cls}" style="margin-bottom:10px">      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">        <span style="font-weight:700;font-size:.9em">#${i+1}</span>        ${tag(r.priority,pillCls)}        <span style="font-size:.72em;color:var(--text2)">${r.category||''}</span>        ${r.estimated_impact?`<span style="font-size:.72em;color:var(--text2)">Impact: ${tag(r.estimated_impact,'blue')}</span>`:''}      </div>      <div style="font-weight:600;margin-bottom:3px">${r.finding||''}</div>      <div style="font-size:.82em;color:var(--text2)"><strong>Action:</strong> ${r.action||''}</div>    </div>`;  });
  h += businessImpact('ROI Summary', [    `<strong>HIGH priority items</strong> address >20% of AI search visibility. Each 10% SoMV gain = ${EST.pipeline_50m} for \$50M ARR company.`,    `<strong>Resource allocation:</strong> GEO market = ${EST.geo_market} (${EST.geo_cagr} CAGR). 98% of CMOs invest, but only ${EST.pct_measure} measure. This is a dedicated function, not a side project.`,    '<strong>Timeline:</strong> Most organizations see measurable SoMV improvement in 60-90 days. Full competitive parity in 6 months.',    `<strong>Competitive window:</strong> ${EST.pct_measure} of marketers track AI citations. Data-driven execution creates outsized returns during this measurement gap.`  ]);
  h += sectionClose();
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 10: CHARTS (delegated to renderCharts in index.html)
// ══════════════════════════════════════════════════════════════
// SECTION 11: STRATEGIC SUMMARY
// ══════════════════════════════════════════════════════════════
function renderStrategicSummary(s) {  const ts=s.triple_stats||{};
const gs=s.graph_stats||{};
const emb=s.embedding_analysis||{};
const sent=s.sentiment_matrix||{};
const sm=s.somv||{};
const overall=sm.overall||{};
const bs=overall.brand_stats||{};
const recs=s.recommendations||[];
const biases=sent.detected_biases||[];
const hs=sent.hallucination_signals||{};
const missing=(gs.missing_authority_nodes||[]);
const negTriples=(ts.negative_triples_brand_a||[]);
  let healthScore = 0;
const brandA = bs['Brand_A'] || {};
  if(brandA.share_of_voice) healthScore += brandA.share_of_voice * 30;
  if(brandA.primary_recommendation_rate) healthScore += brandA.primary_recommendation_rate * 25;
  if(brandA.omission_rate != null) healthScore += (1 - brandA.omission_rate) * 20;
const posRate = (sent.brand_sentiment_matrix||{})['Brand_A'];
  if(posRate) healthScore += (posRate.positive_rate||0) * 15;
  if(biases.filter(b=>b.brand==='Brand_A'&&b.severity==='HIGH').length === 0) healthScore += 10;  healthScore = Math.min(100, Math.round(healthScore));
const healthColor = healthScore > 70 ? 'var(--green)' : healthScore > 40 ? 'var(--yellow)' : 'var(--red)';
const healthLabel = healthScore > 70 ? 'Strong Position' : healthScore > 40 ? 'Needs Improvement' : 'Critical Attention Required';
  let h = sectionHeader('\u2605', 'Strategic Summary: Action Plan', `A consolidated 4-phase plan. GEO market: ${EST.geo_market} (${EST.geo_cagr} CAGR). AI search converts ${EST.conv_multiplier}x better. ${EST.pct_measure} of marketers measure AI citations. Early movers win.`, '&#128640;');
  h += `<div class="res-kpi-row">    <div class="res-kpi" style="border:2px solid ${healthColor};background:${healthColor}11"><div class="val" style="color:${healthColor}">${healthScore}/100</div><div class="lbl">${healthLabel}</div></div>    <div class="res-kpi"><div class="val" style="color:var(--blue)">${pct(brandA.share_of_voice||0)}</div><div class="lbl">Current SoMV</div></div>    <div class="res-kpi"><div class="val" style="color:var(--red)">${negTriples.length}</div><div class="lbl">Negative Claims</div></div>    <div class="res-kpi"><div class="val" style="color:var(--yellow)">${biases.filter(b=>b.severity==='HIGH').length}</div><div class="lbl">Critical Biases</div></div>    <div class="res-kpi"><div class="val" style="color:var(--purple)">${missing.length}</div><div class="lbl">Missing Authority Sources</div></div>  </div>`;
  h += '<h3>&#128680; Phase 1: Emergency Response (Week 1-2)</h3>';
  h += '<div class="res-impl-guide"><ol style="margin:0;padding-left:20px">';
  if(hs.length) h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Hallucination fix:</strong> Create docs countering ${hs.length} hallucination signals. Claude (fastest turnover, 5.1 months) → ChatGPT (900M weekly, ${EST.conv_chatgpt} conversion). Add FAQ schema.</li>`;
  if(biases.filter(b=>b.severity==='HIGH').length) h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Critical bias response:</strong> Counter ${biases.filter(b=>b.severity==='HIGH').length} HIGH biases. Use quotes (+40.6%), stats (+32.8%), authoritative voice (+25.3%).</li>`;
  if(negTriples.length) h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Negative triple content:</strong> Create FAQ pages for ${negTriples.length} negative claims. 20K+ chars = 4.3x more citations. Front-load in first 30% of text.</li>`;
  if(missing.length) h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Missing authority nodes:</strong> Establish presence on ${missing.length} missing sources. ${EST.pct_third_party} of citations are third-party. Prioritize Reddit (+${EST.reddit_growth}), YouTube, G2.</li>`;
  h += '</ol></div>';
  h += '<h3>&#128736; Phase 2: Foundation (Month 1)</h3>';
  h += '<div class="res-impl-guide"><ol style="margin:0;padding-left:20px">';
  h += '<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Schema overhaul:</strong> FAQ (+28% in 21 days), comparison tables (+34% in 14 days), llm.txt (+32% in 14 days). Static HTML = 94% parse; JS = 23%; PDFs = 7%.</li>';
  h += '<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Content rewrite:</strong> Align with ideal answer vectors. Expand key pages to 20K+ chars (4.3x more citations). Front-load claims in first 30%.</li>';
  h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Wikipedia/Wikidata:</strong> ${EST.wikipedia_prune} pruned in 2025. Ensure entity is accurate. #1 ChatGPT source (7.8%).</li>`;
  h += '<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Content freshness:</strong> Pages under 3 months = 48% coverage vs 18% for 24+ months. Update all key pages.</li>';
  h += '</ol></div>';
  h += '<h3>&#128640; Phase 3: Growth (Month 2-3)</h3>';
  h += '<div class="res-impl-guide"><ol style="margin:0;padding-left:20px">';
  h += '<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Platform-specific:</strong> ChatGPT → Wikipedia/Reddit. Google AIO → Reddit/YouTube. Perplexity → Reddit/YouTube/G2/LinkedIn. Claude → NYT/Atlantic/New Yorker.</li>';
  h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Persona content:</strong> Create content for lowest-SoMV personas. ${EST.pct_genz_ai} of Gen Z and 39% of consumers use AI for discovery.</li>`;
  h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Community authority:</strong> Authentic Reddit (+${EST.reddit_growth}), Stack Overflow, Hacker News presence. Brand mentions 3x more valuable than backlinks.</li>`;
  h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Third-party validation:</strong> Benchmarks, case studies on Gartner, G2, Capterra. ${EST.pct_third_party} of citations are third-party.</li>`;
  h += '</ol></div>';
  h += '<h3>&#128200; Phase 4: Sustained Excellence (Ongoing)</h3>';
  h += '<div class="res-impl-guide"><ol style="margin:0;padding-left:20px">';
  h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Monthly analysis:</strong> Track SoMV, bias reduction, citation graph changes. Monitor 6 AI crawlers. Only ${EST.pct_measure} of marketers do this &mdash; be in the minority.</li>`;
  h += `<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Competitive monitoring:</strong> Track competitor SoMV across models. Gains in one may not appear in another (${EST.pct_enterprise_3plus} run 3+ models).</li>`;
  h += '<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>Quarterly freshness:</strong> Keep pages under 3 months. Claude = 5.1 month median; ChatGPT = 8 months. Different cadences per platform.</li>';
  h += '<li style="font-size:.8em;color:var(--text2);margin:4px 0"><strong>MCP readiness:</strong> Model Context Protocol emerging. Structure content for both LLM retrieval and agentic tool-use patterns.</li>';
  h += '</ol></div>';
  h += '<h3>&#128176; ROI Summary</h3>';
  h += deepAnalysis(`    <strong>Cost comparison:</strong> This tool replaces ${EST.agency_monthly} agency retainers. Your cost: content creation + SEO (${EST.monthly_content}) + tool usage = ~\$3K-\$8K/month. Savings: ~\$12K-\$22K/month.<br><br>    <strong>Revenue impact:</strong> AI search converts ${EST.conv_multiplier}x better than organic (Semrush). ChatGPT converts at ${EST.conv_chatgpt} vs Google at ${EST.conv_google} (Seer Interactive). Each dollar of GEO investment has ${EST.conv_multiplier}x the return of traditional SEO.<br><br>    <strong>Timeline:</strong> Measurable SoMV improvement in 60-90 days (Phase 1+2). Full competitive parity in 6 months. The ${EST.pct_measure} measurement gap means most competitors operate blind &mdash; early movers gain outsized returns.  `);
  h += sectionClose();
  return h;
}


