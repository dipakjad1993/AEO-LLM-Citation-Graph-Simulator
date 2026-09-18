// sections.js - Deep, real-time data-driven analysis sections
// Every insight is computed from actual uploaded/analyzed JSON data
// NO hardcoded brand names - all brands are dynamically resolved from entity_maps.json configuration

function getPrimaryBrand(s) {
  const cfg = s.config || {};
  const em = cfg.entity_maps || cfg.entityMaps || {};
  const entityMaps = em.entity_maps || em;
  return entityMaps.your_brand?.primary_name || Object.keys(s.somv?.overall?.brand_stats || {})[0] || 'Your Brand';
}

function isPrimaryBrand(brandName, s) {
  const pb = getPrimaryBrand(s);
  return Boolean(pb && brandName === pb);
}

function sectionHeader(num, title, subtitle, icon) {
  return `<div class="res-section" id="res-section-${num}">
    <div class="res-section-header" onclick="toggleSection(this)">
      <span class="section-chevron">&#9660;</span>
      <span style="font-size:1.4em;flex-shrink:0;width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,rgba(37,99,235,.08),rgba(124,58,237,.08));display:flex;align-items:center;justify-content:center;border:1px solid rgba(37,99,235,.1)">${icon||''}</span>
      <div style="flex:1"><h2 style="margin:0;font-size:1.05em;font-weight:800">${title}</h2></div>
      <span class="section-complete-badge">&#10003; Complete</span>
    </div>
    <div class="res-section-body"><p class="section-desc">${subtitle}</p>`;
}

function businessImpact(title, items) {
  let h = `<div class="res-business-impact"><h4 style="margin:0 0 12px;font-size:.88em;color:#7c3aed;font-weight:700">${title}</h4>`;
  items.forEach((item, i) => {
    h += `<div style="font-size:.82em;color:#334155;margin:5px 0;padding:10px 14px;background:rgba(255,255,255,.7);border-radius:10px;display:flex;gap:10px;align-items:flex-start;line-height:1.55;border:1px solid rgba(196,181,253,.2)">
      <span style="flex-shrink:0;width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.65em;font-weight:700">${i+1}</span>
      <span>${item}</span></div>`;
  });
  return h + '</div>';
}

function implGuide(title, steps) {
  let h = `<div class="res-impl-guide"><h4 style="margin:0 0 12px;font-size:.88em;color:#16a34a;font-weight:700">${title}</h4><div style="display:flex;flex-direction:column;gap:6px">`;
  const colors=['#2563eb','#7c3aed','#16a34a','#ca8a04','#dc2626','#0891b2'];
  steps.forEach((step, i) => {
    const c=colors[i%colors.length];
    h += `<div style="font-size:.82em;color:#334155;padding:10px 14px;background:rgba(255,255,255,.7);border-radius:10px;display:flex;gap:10px;align-items:flex-start;border-left:3px solid ${c};line-height:1.55">
      <span style="flex-shrink:0;width:22px;height:22px;border-radius:7px;background:${c};color:#fff;display:flex;align-items:center;justify-content:center;font-size:.7em;font-weight:700">${i+1}</span>
      <div>${step}</div></div>`;
  });
  return h + '</div></div>';
}

function deepAnalysis(text) {
  return `<div class="res-deep">${text}</div>`;
}

function miniTable(headers, rows, opts={}) {
  let h = '<div class="res-table-wrap"><table class="res-table"><thead><tr>';
  headers.forEach(th => { h += `<th>${th}</th>`; });
  h += '</tr></thead><tbody>';
  rows.forEach(row => {
    const cls = row.cls || '';
    h += `<tr${cls?' class="'+cls+'"':''}>`;
    row.cells.forEach((cell, i) => {
      h += `<td${i===0?' style="font-weight:600"':''}>${cell}</td>`;
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// CMO DASHBOARD: the executive-facing single page of truth.
// All values come from the real module analyses (somv, enterprise,
// sentiment, graph, data_quality) — nothing is hardcoded.
// ══════════════════════════════════════════════════════════════
function renderCMODashboard(s) {
  const sm=s.somv||{};
  const overall=sm.overall||{};
  const bs=overall.brand_stats||{};
  const pb=getPrimaryBrand(s);
  const brandA=bs[pb]||{};
  const ei=s.enterprise_insights||{};
  const sent=s.sentiment_matrix||{};
  const gs=s.graph_stats||{};
  const dq=s.data_quality||{};
  const recs=s.recommendations||[];
  const somvPct=brandA.share_of_voice?(brandA.share_of_voice*100).toFixed(1):'0';

  let h = sectionHeader('cmo', 'CMO Intelligence Dashboard', 'The single page of truth for leadership: every metric below is computed live from this run\'s real analysis modules.', '📊');

  // ── Row 0: headline KPIs ──
  const rank=(overall.leadership_ranking||[]).findIndex(([b])=>b===pb)+1;
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${somvPct}%</div><div class="lbl">Share of Model Voice</div></div>`;
  h += `<div class="res-kpi"><div class="val">${rank?('#'+rank):'-'}</div><div class="lbl">Lead Position</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(dq.citation_count||0)}</div><div class="lbl">Citations Captured</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:${(brandA.omission_rate||0)>0.5?'var(--red)':'var(--yellow)'}">${pct(brandA.omission_rate||0)}</div><div class="lbl">Brand Omission Rate</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:${(sent.detected_biases||[]).filter(b=>b.severity==='HIGH').length?'var(--red)':'var(--green)'}">${(sent.detected_biases||[]).filter(b=>b.severity==='HIGH').length}</div><div class="lbl">Critical Biases</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${(gs.missing_authority_nodes||[]).length}</div><div class="lbl">Missing Authority Sources</div></div>`;
  h += '</div>';

  // ── SoMV by brand: horizontal leaderboard ──
  const allBrands=Object.entries(bs).sort((a,b)=>(b[1].share_of_voice||0)-(a[1].share_of_voice||0));
  if(allBrands.length){
    h += '<h3>Share of Model Voice — Brand Leaderboard</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Brand</th><th>Share of Voice</th><th>Primary Rec Rate</th><th>Omission</th></tr></thead><tbody>';
    allBrands.forEach(([b,stats])=>{
      h += `<tr class="${b===pb?'brand-row':''}"><td style="font-weight:600">${b}${b===pb?' <span style="font-size:.68em;color:var(--blue)">(YOU)</span>':''}</td><td>${(stats.share_of_voice*100).toFixed(1)}%</td><td>${(stats.primary_recommendation_rate*100).toFixed(1)}%</td><td>${(stats.omission_rate*100).toFixed(1)}%</td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  // ── 1. TOP GROUNDING SOURCES MISSING FROM YOUR DOMAIN ──
  h += '<h3>Top Grounding Sources Missing From Your Domain</h3>';
  const uncited=ei.inverse_citation?.uncited_authority||[];
  if(uncited.length){
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Source</th><th>Competitor Citing</th><th>Weight</th><th>Action</th></tr></thead><tbody>';
    uncited.slice(0,10).forEach((n,i)=>{
      const action = n.weight>=70?'Seed technical discussions / claim an expert presence':n.weight>=40?'Publish counter-documentation & update grid profile':'Monitor and build presence';
      h += `<tr><td style="font-weight:600">${n.domain}</td><td>${n.competitor||'-'}</td><td>${n.weight}</td><td style="font-size:.78em;color:var(--blue)">${action}</td></tr>`;
    });
    h += '</tbody></table></div>';
  } else {
    h += insight('No competitor-dominant sources detected yet. This module activates when the citation graph has real source data.', 'warn');
  }

  // ── 2. HALLUCINATION & ATTRIBUTE DEFICIT ALERTS ──
  h += '<h3>Hallucination & Attribute Deficit Alerts</h3>';
  const hs=sent.hallucination_signals||[];
  if(hs.length){
    hs.slice(0,8).forEach(hl=>{
      h += insight(`<strong>${hl.model_id||'Model'}:</strong> ${hl.finding||hl.text||''}`, hl.severity==='HIGH'?'danger':'warn');
    });
  } else {
    h += insight('No hallucination signals flagged in this dataset. Re-run with larger prompt volume to surface attribute deficits.', 'success');
  }

  // ── 3. SEMANTIC GAP REMEDIATION SCRIPTS (ready to publish) ──
  h += '<h3>Semantic Gap Remediation Scripts (Ready to Publish)</h3>';
  const scripts=ei.semantic_gap_remediation?.remediation_scripts||[];
  if(scripts.length){
    scripts.slice(0,5).forEach((sc,i)=>{
      h += `<div class="res-insight med" style="margin-bottom:10px">
        <div style="font-weight:700;margin-bottom:4px">${i+1}. ${sc.title}</div>
        <div style="font-size:.8em;color:var(--text2);margin-bottom:6px"><strong>Target:</strong> ${sc.target_page}</div>
        <details style="font-size:.74em;margin-bottom:6px"><summary style="cursor:pointer;color:var(--blue);font-weight:600">View JSON-LD schema draft</summary><pre style="background:rgba(0,0,0,.04);border-radius:8px;padding:8px;overflow-x:auto;white-space:pre-wrap">${sc.jsonld.replace(/</g,'&lt;')}</pre></details>
        <div style="font-size:.78em;color:var(--text2);white-space:pre-wrap">${sc.markdown}</div>
      </div>`;
    });
  } else {
    h += insight('No remediation scripts generated — no negative claims or missing-source gaps in this dataset. They appear automatically when triples/sources show gaps.', 'success');
  }

  // ── 4. SOURCE-LEVEL ROI PRIORITIZATION ──
  h += '<h3>Source-Level ROI Prioritization</h3>';
  const roi=ei.source_roi?.ranked_sources||[];
  if(roi.length){
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Domain</th><th>Citations</th><th>Models</th><th>Your Share</th><th>Citation Influence Weight</th></tr></thead><tbody>';
    roi.slice(0,10).forEach(r=>{
      h += `<tr><td style="font-weight:600">${r.domain}</td><td>${r.citation_count}</td><td>${r.model_diversity}</td><td>${(r.your_brand_share*100).toFixed(0)}%</td><td><strong>${r.citation_influence_weight}</strong></td></tr>`;
    });
    h += '</tbody></table></div>';
    (ei.source_roi.concentration_alerts||[]).forEach(a=>h+=insight(`<strong>${(a.share*100).toFixed(0)}% of citations from ${a.domains.length} sources.</strong> ${a.finding}`, 'warn'));
  } else {
    h += insight('No ranked sources — requires real citation URLs in the data. This is where PR/outreach teams see exactly where to spend time.', 'warn');
  }

  // ── 5. SoMV TRENDLINES BY MODEL FAMILY & FUNNEL STAGE ──
  h += '<h3>SoMV Trendlines by Model Family & Funnel Stage</h3>';
  const fam=ei.somv_trendlines?.by_model_family||{};
  const stage=ei.somv_trendlines?.by_funnel_stage||{};
  if(Object.keys(fam).length||Object.keys(stage).length){
    if(Object.keys(fam).length){
      h += '<h4>By Model Family</h4>';
      h += miniTable(['Model Family','Your Primary Share','Top Brands'],
        Object.entries(fam).map(([f,shares])=>{
          const mine=shares[pb]||0;
          const leaders=Object.entries(shares).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([b,v])=>`${b} ${(v*100).toFixed(0)}%`).join(', ');
          return {cells:[f,(mine*100).toFixed(1)+'%',leaders],cls:'brand-row'};
        })
      );
    }
    if(Object.keys(stage).length){
      h += '<h4>By Funnel Stage</h4>';
      h += miniTable(['Funnel Stage','Your Primary Share'],
        Object.entries(stage).map(([st,shares])=>({cells:[st,((shares[pb]||0)*100).toFixed(1)+'%'],cls:'brand-row'}))
      );
    }
  } else {
    h += insight('No trendlines — requires multi-model data with funnel-stage labels. Modules activate automatically with real model variance.', 'warn');
  }

  // ── 6. REVENUE AT RISK / PRIORITIZED ACTIONS ──
  h += '<h3>Prioritized Actions (Revenue at Risk)</h3>';
  if(recs.length){
    recs.slice(0,8).forEach((r,i)=>{
      const cls=r.priority==='HIGH'?'danger':r.priority==='MEDIUM'?'warn':'success';
      const pillCls=r.priority==='HIGH'?'high':r.priority==='MEDIUM'?'med':'low';
      h += `<div class="res-insight ${cls}" style="margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><strong style="font-size:.85em">#${i+1}</strong>${tag(r.priority,pillCls)}<span style="font-size:.72em;color:var(--text2)">${r.category||''}</span></div>
        <div style="font-weight:600;font-size:.85em;margin-bottom:2px">${r.finding||''}</div>
        <div style="font-size:.78em;color:var(--text2)"><strong>Action:</strong> ${r.action||''}</div>
      </div>`;
    });
  } else {
    h += insight('No prioritized actions generated.', 'warn');
  }

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 0: DATA QUALITY / COVERAGE TRANSPARENCY
// ══════════════════════════════════════════════════════════════
function renderDataQuality(s) {
  const dq=s.data_quality||{};
  const el=document.getElementById('data-quality-banner');
  if(!el)return;
  if(!dq||!dq.record_count){el.classList.add('hidden');return}
  const warnings=dq.warnings||[];
  const score=dq.coverage_score||0;
  const color=score>=70?'var(--green)':score>=40?'var(--yellow)':'var(--red)';
  const label=score>=70?'Healthy dataset':score>=40?'Partial coverage':'Thin dataset';
  let h=`<div class="card" style="margin-bottom:18px;border-left:4px solid ${color}">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="min-width:150px"><div style="font-size:1.7em;font-weight:800;color:${color}">${score}/100</div><div style="font-size:.72em;color:var(--text2)">Data Coverage Score</div></div>
      <div style="flex:1;min-width:220px">
        <div style="font-weight:700;font-size:.92em">What was actually analyzed (transparent report)</div>
        <div style="font-size:.78em;color:var(--text2);margin-top:4px">
          ${dq.record_count} records · ${dq.records_with_text} with text · ${dq.citation_count} citations · ${dq.records_with_brand_mention} with brand mention · ${(dq.unique_models||[]).length} models
          ${dq.declared_prompt_count?` · file declares ${dq.declared_prompt_count} prompts`:''}
        </div>
      </div>
      <div style="font-size:.72em;font-weight:600;color:${color}">${label}</div>
    </div>
    ${warnings.length?`<div style="margin-top:10px;padding-top:10px;border-top:1px solid #eee">
      ${warnings.map(w=>`<div style="font-size:.75em;color:var(--text2);margin:3px 0">⚠ ${w}</div>`).join('')}
    </div>`:''}
  </div>`;
  el.innerHTML=h;
  el.classList.remove('hidden');
}

// ══════════════════════════════════════════════════════════════
// SECTION 1: EXECUTIVE SUMMARY
// ══════════════════════════════════════════════════════════════
function renderSection1(s) {
  const pb=getPrimaryBrand(s);
  const ts=s.triple_stats||{};
  const gs=s.graph_stats||{};
  const emb=s.embedding_analysis||{};
  const sent=s.sentiment_matrix||{};
  const sm=s.somv||{};
  const overall=sm.overall||{};
  const bs=overall.brand_stats||{};
  const recs=s.recommendations||[];
  const biases=sent.detected_biases||[];
  const hs=sent.hallucination_signals||[];
  const brandA=bs[pb]||{};
  const ragPct=s.attribution_stats?.total_responses?((s.attribution_stats.rag_enabled_count/s.attribution_stats.total_responses)*100).toFixed(0):'-';
  const successRate=s.total_records?((s.successful_records/s.total_records)*100).toFixed(1):'0';
  const avgCitations=sm.citation_depth?.avg_citations_per_response?.toFixed(2)||'-';
  const uniqueTriples=ts.unique_triples||0;
  const totalTriples=ts.total_triples_extracted||0;
  const dedupRate=totalTriples?(((totalTriples-uniqueTriples)/totalTriples)*100).toFixed(1):'0';
  const avgLength=emb.text_statistics?.avg_response_length?.toFixed(0)||'-';
  const medianLength=emb.text_statistics?.median_response_length?.toFixed(0)||'-';
  const clusterCount=(emb.embedding_clusters||[]).length;
  const avgIntraSim=brandA.share_of_voice?(brandA.share_of_voice*100).toFixed(1):'0';
  const modelCount=s.attribution_stats?.unique_models||0;
  const totalBrands=Object.keys(bs).length;
  const graphCount=gs.graph_count||0;
  const totalNodes=Object.values(gs.graphs||{}).reduce((sum,g)=>sum+(g.nodes||0),0);
  const totalEdges=Object.values(gs.graphs||{}).reduce((sum,g)=>sum+(g.edges||0),0);
  const missingNodes=gs.missing_authority_nodes?.length||0;
  const compDom=gs.competitor_dominant_sources?.length||0;
  const highBiases=biases.filter(b=>b.severity==='HIGH').length;
  const medBiases=biases.filter(b=>b.severity==='MEDIUM').length;
  const lowBiases=biases.filter(b=>b.severity==='LOW').length;
  const negTriplesKey = Object.keys(ts).find(k => k.startsWith('negative_triples_')) || '';
  const posTriplesKey = Object.keys(ts).find(k => k.startsWith('positive_triples_')) || '';
  const negTriples = ts[negTriplesKey] || [];
  const posTriples = ts[posTriplesKey] || [];
  const posNegRatio=negTriples?(posTriples/negTriples).toFixed(1):posTriples?'>10':'-';
  const textStats=emb.text_statistics||{};
  const responsesByModel=textStats.responses_by_model|| {};
  const longestModel=Object.entries(responsesByModel).sort((a,b)=>(b[1].avg_length||0)-(a[1].avg_length||0))[0];
  const shortestModel=Object.entries(responsesByModel).sort((a,b)=>(a[1].avg_length||0)-(b[1].avg_length||0))[0];

  let h = sectionHeader(1, 'Executive Summary', `Comprehensive analysis across ${modelCount} LLM models, ${s.total_records} records, ${totalBrands} brands. Real-time data-driven insights from your submitted JSON files.`, '');

  // Primary KPIs
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(s.total_records)}</div><div class="lbl">Total Records</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(s.successful_records)}</div><div class="lbl">Successful</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${successRate}%</div><div class="lbl">Success Rate</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${modelCount}</div><div class="lbl">LLM Models</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${totalBrands}</div><div class="lbl">Brands Tracked</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${ragPct}%</div><div class="lbl">RAG Coverage</div></div>`;
  h += '</div>';

  // Secondary KPIs
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(totalTriples)}</div><div class="lbl">Triples Extracted</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(uniqueTriples)}</div><div class="lbl">Unique Patterns</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--teal,#0891b2)">${dedupRate}%</div><div class="lbl">Deduplication Rate</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${graphCount}</div><div class="lbl">Citation Graphs</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(totalNodes)}</div><div class="lbl">Graph Nodes</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(totalEdges)}</div><div class="lbl">Graph Edges</div></div>`;
  h += '</div>';

  // Third row - risk/health KPIs
  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${highBiases}</div><div class="lbl">HIGH Biases</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${medBiases}</div><div class="lbl">MEDIUM Biases</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${hs.length}</div><div class="lbl">Hallucinations</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${missingNodes}</div><div class="lbl">Missing Nodes</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${avgCitations}</div><div class="lbl">Avg Citations</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(recs.length)}</div><div class="lbl">Recommendations</div></div>`;
  h += '</div>';

  // Pipeline deep dive
  h += deepAnalysis(`<strong>Pipeline Summary:</strong> ${fmt(s.total_records)} records processed with ${successRate}% success rate across <strong>${modelCount} LLM models</strong> (${ragPct}% RAG-enabled). ${fmt(totalTriples)} triples extracted (${uniqueTriples} unique, ${dedupRate}% deduplication). ${graphCount} citation graphs built with ${fmt(totalNodes)} nodes and ${fmt(totalEdges)} edges. ${clusterCount} semantic clusters identified using <strong>${emb.model_used||'N/A'}</strong> embeddings. Average response length: ${avgLength} chars (median: ${medianLength}).`);

  // Model-specific deep analysis
  if(longestModel && shortestModel) {
    h += deepAnalysis(`<strong>Model Response Depth:</strong> <strong>${longestModel[0]}</strong> generates the longest responses (avg ${longestModel[1].avg_length?.toFixed(0)} chars from ${fmt(longestModel[1].count)} responses). <strong>${shortestModel[0]}</strong> generates the shortest (avg ${shortestModel[1].avg_length?.toFixed(0)} chars). This ${((longestModel[1].avg_length||1)/(shortestModel[1].avg_length||1)).toFixed(1)}x difference in response depth significantly impacts citation potential &mdash; longer responses typically surface more claims, facts, and citation opportunities.`);
  }

  // Brand health overview
  if(brandA.share_of_voice != null) {
    const sovPct=(brandA.share_of_voice*100).toFixed(1);
    const mentionPct=(brandA.mention_rate*100).toFixed(1);
    const primPct=(brandA.primary_recommendation_rate*100).toFixed(1);
    const omitPct=(brandA.omission_rate*100).toFixed(1);
    h += deepAnalysis(`<strong>\ Health Snapshot:</strong> Share of Voice: <strong style="color:${sovPct>30?'var(--green)':sovPct>15?'var(--yellow)':'var(--red)'}">${sovPct}%</strong> | Mention Rate: <strong>${mentionPct}%</strong> | Primary Recommendation: <strong style="color:${primPct>20?'var(--green)':'var(--red)'}">${primPct}%</strong> | Omission Rate: <strong style="color:${omitPct<20?'var(--green)':'var(--red)'}">${omitPct}%</strong> | Positive:Negative Triples: <strong style="color:${posNegRatio>2?'var(--green)':'var(--red)'}">${posNegRatio}:1</strong> (${posTriples} pos / ${negTriples} neg)`);
  }

  // Data source indicator (+ QUARANTINE banner: synthetic rows must never pass as prod)
  const dataSource = s.data_source || {};
  const synthN = (s.data_quality && s.data_quality.synthetic_quarantined) || s.synthetic_quarantined || 0;
  const runIsQuarantined = /QUARANTINED/i.test(dataSource.runId || '') || /QUARANTINED/i.test(s?.pipeline_meta?.run_dir || '') || synthN > 0 || !!s?.pipeline_meta?.synthetic_allowed;
  if (runIsQuarantined) {
    h += `<div class="synthetic-banner" style="background:#d93025;color:#fff;padding:12px 16px;border-radius:10px;margin:12px 0;font-weight:700">⛔ SYNTHETIC — NOT PROD EVIDENCE: run_demo_synthetic_QUARANTINED${synthN ? ` (${synthN} demo_synthetic rows)` : ''}. Wilson CIs here describe the demo corpus only. Do not join with prod CSVs.</div>`;
  }
  // Lite-vs-Full ML badge (never let VADER pass as RoBERTa)
  if (s?.pipeline_meta?.lite_mode || (s?.sentiment_matrix && s.sentiment_matrix.engine && /vader|keyword|fallback/i.test(s.sentiment_matrix.engine))) {
    h += `<div class="lite-badge" style="background:#fef7e0;border:1px solid #f9ab00;color:#7a4a00;padding:8px 14px;border-radius:20px;margin:8px 0;font-size:.82em;font-weight:600;display:inline-block">Lite mode: transformer sentiment OFF (VADER/keyword fallback) — install requirements.txt for RoBERTa + MiniLM-trf</div>`;
  }
  if(dataSource.dataSource === 'orchestrator_run') {
    h += deepAnalysis(`<strong>Data Source:</strong> Analysis based on <strong>real LLM API responses</strong> from the most recent orchestrator run. Every metric is computed from actual model outputs.`);
  } else if(dataSource.hasUploads) {
    h += deepAnalysis(`<strong>Data Source:</strong> Analysis based on <strong>uploaded JSON files</strong> from your real simulation data. All metrics are computed from your actual results, not synthetic data.`);
  } else {
    h += deepAnalysis(`<strong>Data Source:</strong> Analysis based on real collected LLM responses.`);
  }

  // Biases and risks
  if(biases.length) h += insight(`<strong>${biases.length} bias patterns detected:</strong> ${highBiases} HIGH severity, ${medBiases} MEDIUM severity, ${lowBiases} LOW severity. ${highBiases?'HIGH-severity biases actively harm brand perception across LLM responses.':'No critical biases found.'}`, highBiases?'danger':'warn');
  if(hs.length) h += insight(`<strong>${hs.length} hallucination signals:</strong> Conflicting or unverifiable claims detected across models. These require immediate attention to prevent misinformation propagation.`, 'warn');
  if(posNegRatio!=='-' && posNegRatio<2) h += insight(`<strong>Low positive-to-negative triple ratio (${posNegRatio}:1):</strong> LLMs generate significantly more Negative Claims About \ than positive ones. Target ratio is 3:1 or higher.`, 'danger');

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 2: ATTRIBUTION ANALYSIS (RAG vs BASE)
// ══════════════════════════════════════════════════════════════
function renderSection2(s) {
  const attr=s.attribution_stats||{};
  const sm=s.somv||{};
  const ragDist=attr.rag_brand_distribution||{};
  const baseDist=attr.base_brand_distribution||{};
  const allBrands=new Set([...Object.keys(ragDist),...Object.keys(baseDist)]);
  const ragVsBase=sm.rag_vs_base||{};
  const ragRatio=attr.total_responses?((attr.rag_enabled_count/attr.total_responses)*100).toFixed(1):'-';
  const baseRatio=attr.total_responses?((attr.rag_disabled_count/attr.total_responses)*100).toFixed(1):'-';
  const ragInsights=ragVsBase.attribution_insights||[];

  let h = sectionHeader(2, 'Attribution: RAG vs Base Weights', `Determines whether brand visibility issues stem from web indexing (RAG) or pre-training data (base weights). ${ragRatio}% RAG-enabled, ${baseRatio}% base-weight-only. Real-time analysis from ${fmt(attr.total_responses)} responses.`, '');

  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(attr.rag_enabled_count)}</div><div class="lbl">RAG-Enabled</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${fmt(attr.rag_disabled_count)}</div><div class="lbl">Base Weights Only</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${ragRatio}%</div><div class="lbl">RAG Coverage</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(attr.unique_models)}</div><div class="lbl">Models Tested</div></div>`;
  h += '</div>';

  // RAG vs Base breakdown
  if(Object.keys(ragDist).length || Object.keys(baseDist).length) {
    h += '<h3>Brand Distribution by Attribution Mode</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Brand</th><th>RAG Count</th><th>RAG %</th><th>Base Count</th><th>Base %</th><th>Total</th><th>RAG Delta</th></tr></thead><tbody>';
    [...allBrands].sort().forEach(b=>{
      const rc=ragDist[b]||0;
      const bc=baseDist[b]||0;
      const tot=rc+bc;
      const ragPctVal=attr.rag_enabled_count?((rc/attr.rag_enabled_count)*100).toFixed(1):'0.0';
      const basePctVal=attr.rag_disabled_count?((bc/attr.rag_disabled_count)*100).toFixed(1):'0.0';
      const delta=(parseFloat(ragPctVal)-parseFloat(basePctVal)).toFixed(1);
      const deltaColor=parseFloat(delta)>5?'var(--green)':parseFloat(delta)<-5?'var(--red)':'var(--text3)';
      const deltaSign=parseFloat(delta)>0?'+':'';
      h += `<tr\$\{b === pb?' class="brand-row"':''}><td><strong>${b}</strong></td><td>${fmt(rc)}</td><td>${ragPctVal}%</td><td>${fmt(bc)}</td><td>${basePctVal}%</td><td>${fmt(tot)}</td><td style="color:${deltaColor};font-weight:600">${deltaSign}${delta}%</td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  // Attribution insights from computed data
  if(ragInsights.length) {
    h += '<h3>Attribution Insights</h3>';
    ragInsights.forEach(insight_data => {
      const isRagBoost=insight_data.attribution==='rag_boosted';
      h += `<div class="res-insight ${isRagBoost?'success':'warn'}"><strong>${insight_data.brand}</strong> - ${insight_data.attribution==='rag_boosted'?'RAG-Boosted':'Pre-Training Boosted'}: RAG rate <strong>${(insight_data.rag_rate*100).toFixed(1)}%</strong> vs Base rate <strong>${(insight_data.base_rate*100).toFixed(1)}%</strong> (delta: <strong>${insight_data.delta>0?'+':''}${(insight_data.delta*100).toFixed(1)}%</strong>)<div style="font-size:.78em;color:var(--text2);margin-top:3px">${insight_data.insight}</div></div>`;
    });
  }

  // SoMV RAG vs Base comparison
  const ragEnabled=ragVsBase.rag_enabled||{};
  const ragDisabled=ragVsBase.rag_disabled||{};
  if((ragEnabled.brand_stats||{}).length || (ragDisabled.brand_stats||{}).length) {
    h += '<h3>SoMV Comparison: RAG-Enabled vs RAG-Disabled</h3><div class="res-grid2">';
    [{label:'RAG-Enabled (Web Search ON)',data:ragEnabled,key:'rag_enabled'},
     {label:'RAG-Disabled (Base Weights Only)',data:ragDisabled,key:'rag_disabled'}
    ].forEach(({label,data,key})=>{
      const dBrand=data.brand_stats||{};
      h += `<div><h4>${label} (${fmt(data.total)} responses)</h4>`;
      h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Brand</th><th>Mention Rate</th><th>Count</th></tr></thead><tbody>';
      Object.entries(dBrand).sort((a,b)=>(b[1].mention_rate||0)-(a[1].mention_rate||0)).forEach(([br,st])=>{
        h += `<tr\$\{br === pb?' class="brand-row"':''}><td>${br}</td><td>${pct(st.mention_rate)}</td><td>${fmt(st.mention_count)}</td></tr>`;
      });
      h += '</tbody></table></div></div>';
    });
    h += '</div>';
  }

  // Deep analysis
  h += deepAnalysis(`<strong>What this tells you:</strong> If \ performs better in RAG mode, your web presence is strong but pre-training data needs work (Wikipedia, media coverage, PR). If better in base mode, your pre-trained authority is solid but web indexing needs improvement (structured data, schema markup, crawlers). RAG coverage of ${ragRatio}% means ${100-parseFloat(ragRatio)}% of responses rely entirely on pre-trained knowledge.`);

  h += implGuide('Fix Attribution Based on Results', [
    `<strong>If RAG-weak:</strong> Implement Schema.org (FAQ, Product, TechArticle) on key pages. Static HTML = 94% parse success vs JS at 23% or PDFs at 7%. Target ${fmt(attr.rag_disabled_count)} base-weight responses.`,
    `<strong>If Base-weak:</strong> Improve pre-training authority via Wikipedia/Wikidata presence, PR campaigns, high-authority media mentions. This affects ${fmt(attr.rag_disabled_count)} base-weight-only responses.`,
    `<strong>Crawler audit:</strong> Check robots.txt for GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended, Bingbot. Ensure none are blocked.`,
    '<strong>Content freshness:</strong> Pages under 3 months old get ~48% AI coverage vs ~18% for 24+ months. Refresh stale pages first.'
  ]);

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 3: SHARE OF MODEL VOICE (SoMV)
// ══════════════════════════════════════════════════════════════
function renderSection3(s) {
  const sm=s.somv||{};
  const overall=sm.overall||{};
  const bs=overall.brand_stats||{};
  const ranking=overall.leadership_ranking||[];
  const byModel=sm.by_model||{};
  const byPersona=sm.by_persona||{};
  const byTurn=sm.by_turn_type||{};
  const cd=sm.citation_depth||{};
  const omission=sm.omission_analysis||{};
  const omissionRates=omission.omission_rates||{};
  const compGaps=sm.competitive_gaps||[];
  const brandA=bs[pb]||{};

  let h = sectionHeader(3, 'Share of Model Voice (SoMV)', `Your brand visibility across all ${Object.keys(byModel).length} LLM models. Computed from real-time mention analysis across ${overall.total_responses||0} responses.`, '');

  // Brand A health card
  if(brandA.share_of_voice!=null) {
    const sov=(brandA.share_of_voice*100).toFixed(1);
    const mention=(brandA.mention_rate*100).toFixed(1);
    const primary=(brandA.primary_recommendation_rate*100).toFixed(1);
    const omit=(brandA.omission_rate*100).toFixed(1);
    const health=sov>30?'Strong':sov>15?'Moderate':'Weak';
    const healthColor=sov>30?'var(--green)':sov>15?'var(--yellow)':'var(--red)';
     h += `<div class="res-insight ${sov>30?'success':sov>15?'warn':'danger'}" style="padding:16px 20px;border-left-width:6px"><strong style="font-size:.9em">${pb} Performance Profile</strong> &mdash; Health: <strong style="color:${healthColor}">${health}</strong><div style="margin-top:6px;font-size:.78em;color:var(--text2)">SoMV: <strong>${sov}%</strong> | Mention Rate: <strong>${mention}%</strong> | Primary Recommendation: <strong>${primary}%</strong> | Omission: <strong>${omit}%</strong> | Secondary Mentions: <strong>${fmt(brandA.secondary_mention_count||0)}</strong></div></div>`;
  }

  // Overall rankings with medals
  if(ranking.length) {
    h += '<h3>Overall Brand Rankings</h3><div class="res-kpi-row">';
    ranking.forEach(([br,st],i)=>{
      const medal=i===0?'1st':i===1?'2nd':i===2?'3rd':'';
      const clr=i===0?'var(--green)':i===1?'var(--blue)':'var(--text3)';
      const sovPct=(st.share_of_voice*100).toFixed(1);
      h += `<div class="res-kpi"><div class="val" style="color:${clr}">${medal} ${sovPct}%</div><div class="lbl">${br}</div></div>`;
    });
    h += '</div>';
  }

  // Full brand performance table
  if(Object.keys(bs).length) {
    h += '<h3>Detailed Brand Performance</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Brand</th><th>SoMV</th><th>Mention Rate</th><th>Primary Rec Rate</th><th>Secondary</th><th>Omission</th><th>Total Mentions</th></tr></thead><tbody>';
    Object.entries(bs).sort((a,b)=>(b[1].share_of_voice||0)-(a[1].share_of_voice||0)).forEach(([br,st])=>{
      const barW=((st.share_of_voice||0)*100).toFixed(0);
      const barColor=br=== pb?'var(--green)':br.includes('B')?'var(--red)':'var(--blue)';
      h += `<tr\$\{br === pb?' class="brand-row"':''}><td><strong>${br}</strong></td>`;
      h += `<td><div style="display:flex;align-items:center;gap:6px"><div style="width:80px"><div class="res-bar"><div class="fill" style="width:${barW}%;background:${barColor}"></div></div></div><span>${pct(st.share_of_voice)}</span></div></td>`;
      h += `<td>${pct(st.mention_rate)}</td><td>${pct(st.primary_recommendation_rate)}</td><td>${fmt(st.secondary_mention_count)}</td><td>${pct(st.omission_rate)}</td><td>${fmt(st.mention_count)}</td></tr>`;
    });
    h += '</tbody></table></div>';
    h += deepAnalysis(`Primary Recommendation Rate = how often your brand is the #1 suggested option. Omission Rate >20% means LLMs frequently ignore your brand entirely. Target: >50% primary rec rate, <10% omission rate, >80% mention rate.`);
  }

  // SoMV by Model (deep dive)
  if(Object.keys(byModel).length) {
    h += '<h3>SoMV by LLM Model</h3>';
    const modelBrands=new Set();
    Object.values(byModel).forEach(d=>Object.keys(d.brand_stats||{}).forEach(b=>modelBrands.add(b)));
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Model</th><th>Responses</th>';
    [...modelBrands].sort().forEach(b=>{h += `<th>${b} SoMV</th><th>${b} Mention</th>`});
    h += '</tr></thead><tbody>';
    Object.entries(byModel).sort((a,b)=>b[1].total-a[1].total).forEach(([m,d])=>{
      h += `<tr><td><strong>${m}</strong></td><td>${fmt(d.total)}</td>`;
      [...modelBrands].sort().forEach(b=>{
        const st=(d.brand_stats||{})[b]||{};
        const sovPct=(st.share_of_voice||0)*100;
        const sovColor=sovPct>25?'var(--green)':sovPct>10?'var(--yellow)':'var(--red)';
        h += `<td style="color:${sovColor};font-weight:600">${pct(st.share_of_voice)}</td><td>${pct(st.mention_rate)}</td>`;
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += deepAnalysis(`<strong>Model variance analysis:</strong> SoMV can vary significantly across models due to different training data, retrieval strategies, and fine-tuning approaches. A brand that leads on one model may lag on another. This ${Object.keys(byModel).length}-model analysis reveals exactly where you're strong and where you're weak.`);
  }

  // SoMV by Persona
  if(Object.keys(byPersona).length) {
    h += '<h3>SoMV by Buyer Persona</h3>';
    const personaBrands=new Set();
    Object.values(byPersona).forEach(d=>Object.keys(d.brand_stats||{}).forEach(b=>personaBrands.add(b)));
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Persona</th><th>Responses</th>';
    [...personaBrands].sort().forEach(b=>{h += `<th>${b} SoMV</th>`});
    h += '</tr></thead><tbody>';
    Object.entries(byPersona).forEach(([p,d])=>{
      h += `<tr><td><strong>${p.replace(/_/g,' ')}</strong></td><td>${fmt(d.total)}</td>`;
      [...personaBrands].sort().forEach(b=>{
        const st=(d.brand_stats||{})[b]||{};
        h += `<td>${pct(st.share_of_voice)}</td>`;
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
  }

  // SoMV by Turn Type
  if(Object.keys(byTurn).length) {
    h += '<h3>SoMV by Conversation Turn Type</h3>';
    const turnBrands=new Set();
    Object.values(byTurn).forEach(d=>Object.keys(d.brand_stats||{}).forEach(b=>turnBrands.add(b)));
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Turn Type</th><th>Responses</th>';
    [...turnBrands].sort().forEach(b=>{h += `<th>${b} SoMV</th>`});
    h += '</tr></thead><tbody>';
    Object.entries(byTurn).forEach(([t,d])=>{
      h += `<tr><td><strong>${t.replace(/_/g,' ')}</strong></td><td>${fmt(d.total)}</td>`;
      [...turnBrands].sort().forEach(b=>{
        const st=(d.brand_stats||{})[b]||{};
        h += `<td>${pct(st.share_of_voice)}</td>`;
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
  }

  // Citation Depth
  if(cd.avg_citations_per_response!=null) {
    h += '<h3>Citation Depth Analysis</h3>';
    h += '<div class="res-kpi-row">';
    h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${cd.avg_citations_per_response.toFixed(2)}</div><div class="lbl">Avg Citations/Response</div></div>`;
    const dist=cd.citation_distribution||{};
    Object.entries(dist).forEach(([k,v])=>{
      h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(v)}</div><div class="lbl">${k.replace(/_/g,' ')}</div></div>`;
    });
    h += '</div>';

    const topDomains=cd.top_cited_domains||{};
    if(Object.keys(topDomains).length) {
      h += '<h4>Top Cited Domains</h4>';
      const totalCitations=Object.values(topDomains).reduce((a,b)=>a+b,0);
      h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Domain</th><th>Citations</th><th>Share</th><th></th></tr></thead><tbody>';
      Object.entries(topDomains).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([dom,cnt])=>{
        const sharePct=((cnt/totalCitations)*100).toFixed(1);
        h += `<tr><td><strong>${dom}</strong></td><td>${fmt(cnt)}</td><td>${sharePct}%</td><td><div class="res-bar" style="width:120px"><div class="fill" style="width:${sharePct}%;background:var(--blue)"></div></div></td></tr>`;
      });
      h += '</tbody></table></div>';
      h += deepAnalysis(`<strong>Citation concentration:</strong> Top domain captures ${((Object.values(topDomains).sort((a,b)=>b-a)[0]/totalCitations)*100).toFixed(1)}% of all citations. Total: ${fmt(totalCitations)} citations across ${Object.keys(topDomains).length} unique domains.`);
    }
  }

  // Omission Analysis
  if(Object.keys(omissionRates).length) {
    h += '<h3>Omission Analysis: Where You\'re Invisible</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Brand</th><th>Omitted</th><th>Omission Rate</th><th>Visibility Score</th><th></th></tr></thead><tbody>';
    Object.entries(omissionRates).forEach(([br,st])=>{
      const vis=100-(st.omission_rate*100);
      const visColor=vis>80?'var(--green)':vis>50?'var(--yellow)':'var(--red)';
      h += `<tr\$\{br === pb?' class="brand-row"':''}><td><strong>${br}</strong></td><td>${fmt(st.omitted_count)}</td><td>${pct(st.omission_rate)}</td><td><div style="display:flex;align-items:center;gap:6px"><div style="width:60px"><div class="res-bar"><div class="fill" style="width:${vis}%;background:${visColor}"></div></div></div><span style="font-weight:600">${vis.toFixed(1)}%</span></div></td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  // Competitive Gaps
  if(compGaps.length) {
    h += '<h3>Competitive Gaps</h3>';
    compGaps.forEach(gap=>{
      h += `<div class="res-insight danger"><strong>${gap.competitor}</strong> leads \ by <strong>${(gap.gap*100).toFixed(1)}%</strong> in primary recommendation rate (Their: ${(gap.competitor_primary_rate*100).toFixed(1)}% vs Yours: ${(gap.your_primary_rate*100).toFixed(1)}%)<div style="font-size:.78em;color:var(--text2);margin-top:3px"><strong>Action:</strong> ${gap.recommendation}</div></div>`;
    });
  }

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 4: TRIPLE EXTRACTION
// ══════════════════════════════════════════════════════════════
function renderSection4(s) {
  const ts=s.triple_stats||{};
  const sentDist=ts.sentiment_distribution||{};
  const triplesByBrand=ts.triples_by_brand||{};
  const topPred=ts.top_predicates||[];
  const topObj=ts.top_objects||[];
  const negTriplesKey = Object.keys(ts).find(k => k.startsWith('negative_triples_')) || '';
  const posTriplesKey = Object.keys(ts).find(k => k.startsWith('positive_triples_')) || '';
  const negTriples=ts[negTriplesKey]||[];
  const posTriples=ts[posTriplesKey]||[];

  let h = sectionHeader(4, 'Triple Extraction: What LLMs Say About You', `Every LLM response decomposed into structured (Subject, Predicate, Object) claims. ${ts.extraction_method||'N/A'} extraction method. These triples form the knowledge graph LLMs use.`, '');

  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(ts.total_triples_extracted)}</div><div class="lbl">Total Triples</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(ts.unique_triples)}</div><div class="lbl">Unique Patterns</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${tag(ts.extraction_method||'-','purple')}</div><div class="lbl">Method</div></div>`;
  const totalSent=Object.values(sentDist).reduce((a,b)=>a+b,0);
  const posRate=totalSent?((sentDist.positive||0)/totalSent*100).toFixed(1):'0';
  const negRate=totalSent?((sentDist.negative||0)/totalSent*100).toFixed(1):'0';
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${posRate}%</div><div class="lbl">Positive Rate</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${negRate}%</div><div class="lbl">Negative Rate</div></div>`;
  h += '</div>';

  // Sentiment Distribution
  if(Object.keys(sentDist).length) {
    h += '<h3>Triple Sentiment Distribution</h3><div class="res-kpi-row">';
    Object.entries(sentDist).forEach(([k,v])=>{
      const col=k==='positive'?'var(--green)':k==='negative'?'var(--red)':k==='comparative'?'var(--purple)':'var(--blue)';
      const pctVal=totalSent?((v/totalSent)*100).toFixed(1):'0';
      h += `<div class="res-kpi"><div class="val" style="color:${col}">${fmt(v)}</div><div class="lbl">${k} (${pctVal}%)</div></div>`;
    });
    h += '</div>';
    h += deepAnalysis(`<strong>Sentiment health check:</strong> ${posRate}% positive, ${negRate}% negative. ${parseFloat(negRate)>15?'Negative rate >15% indicates a systematic reputation problem requiring immediate attention.':'Negative rate is within acceptable range.'} Positive-to-negative ratio: <strong>${negRate>0?(posRate/negRate).toFixed(1):'>100'}:1</strong> (target: >3:1).`);
  }

  // Triples by Brand with detailed breakdown
  if(Object.keys(triplesByBrand).length) {
    h += '<h3>Triples by Brand</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Brand</th><th>Total</th><th>Positive</th><th>Negative</th><th>Neutral</th><th>Comparative</th><th>Pos Rate</th><th>Neg Rate</th><th>Pos:Neg</th></tr></thead><tbody>';
    Object.entries(triplesByBrand).sort((a,b)=>(b[1].count||0)-(a[1].count||0)).forEach(([br,st])=>{
      const posR=st.count?((st.positive/st.count)*100).toFixed(1):'0.0';
      const negR=st.count?((st.negative/st.count)*100).toFixed(1):'0.0';
      const ratio=st.negative?(st.positive/st.negative).toFixed(1):st.positive?'>100':'-';
      h += `<tr\$\{br === pb?' class="brand-row"':''}><td><strong>${br}</strong></td><td>${fmt(st.count)}</td><td style="color:var(--green)">${fmt(st.positive)}</td><td style="color:var(--red)">${fmt(st.negative)}</td><td>${fmt(st.neutral)}</td><td style="color:var(--purple)">${fmt(st.comparative)}</td><td>${posR}%</td><td style="color:${parseFloat(negR)>5?'var(--red)':''}">${negR}%</td><td style="font-weight:600;color:${ratio!=='-'&&ratio>2?'var(--green)':'var(--red)'}">${ratio}:1</td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  // Top Predicates
  if(topPred.length) {
    h += '<h3>Top Predicates (Claim Types)</h3>';
    const maxP=topPred[0]?.[1]||1;
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>#</th><th>Predicate</th><th>Count</th><th>Distribution</th></tr></thead><tbody>';
    topPred.slice(0,15).forEach(([p,c],i)=>{
      h += `<tr><td>${i+1}</td><td><strong>${p}</strong></td><td>${fmt(c)}</td><td><div class="res-bar" style="width:160px"><div class="fill" style="width:${((c/maxP)*100).toFixed(0)}%;background:linear-gradient(90deg,var(--blue),var(--purple))"></div></div></td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  // Top Objects
  if(topObj.length) {
    h += '<h3>Top Objects (Claim Subjects)</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>#</th><th>Object</th><th>Count</th></tr></thead><tbody>';
    topObj.slice(0,10).forEach(([o,c],i)=>{
      h += `<tr><td>${i+1}</td><td>${o}</td><td>${fmt(c)}</td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  // Negative Claims with full detail
  if(negTriples.length) {
    const uniqueNeg=[...new Map(negTriples.map(t=>[`${t.subject}|${t.predicate}|${t.object}`,t])).values()];
    h += `<h3 style="color:var(--red)">Negative Claims About \ (${uniqueNeg.length} unique, ${negTriples.length} total)</h3>`;
    h += deepAnalysis(`Each negative claim below is an active reputation threat. When a buyer researches via AI, these claims can kill a deal before you know it exists. A single targeted FAQ page (~500-1000 to create) can counter each negative triple across all LLMs.`);
    uniqueNeg.slice(0,10).forEach(t=>{
      h += `<div class="res-insight danger"><strong>${t.subject}</strong> <span style="color:var(--red)">${t.predicate}</span> <strong>${t.object}</strong><div class="res-quote">"${t.sentence||''}"</div></div>`;
    });
  }

  // Positive Claims
  if(posTriples.length) {
    const uniquePos=[...new Map(posTriples.map(t=>[`${t.subject}|${t.predicate}|${t.object}`,t])).values()];
    h += `<h3 style="color:var(--green)">Positive Claims About \ (${uniquePos.length} unique, ${posTriples.length} total)</h3>`;
    uniquePos.slice(0,10).forEach(t=>{
      h += `<div class="res-insight success"><strong>${t.subject}</strong> <span style="color:var(--green)">${t.predicate}</span> <strong>${t.object}</strong><div class="res-quote">"${t.sentence||''}"</div></div>`;
    });
  }

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 5: CITATION GRAPHS
// ══════════════════════════════════════════════════════════════
function renderSection5(s) {
  const gs=s.graph_stats||{};
  const graphs=gs.graphs||{};
  const missing=gs.missing_authority_nodes||[];
  const compDom=gs.competitor_dominant_sources||[];
  const yourSources=gs.your_brand_citation_sources||[];

  let h = sectionHeader(5, 'Citation Graph Construction', `${gs.graph_count} network graphs built showing citation flows between LLMs, brands, and source domains.`, '');

  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(gs.graph_count)}</div><div class="lbl">Graphs Built</div></div>`;
  const totalN=Object.values(graphs).reduce((s,g)=>s+(g.nodes||0),0);
  const totalE=Object.values(graphs).reduce((s,g)=>s+(g.edges||0),0);
  const avgDensity=Object.values(graphs).reduce((s,g)=>s+(g.density||0),0)/Math.max(Object.values(graphs).length,1);
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(totalN)}</div><div class="lbl">Total Nodes</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(totalE)}</div><div class="lbl">Total Edges</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${fmt(missing.length)}</div><div class="lbl">Missing Authority Nodes</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${fmt(compDom.length)}</div><div class="lbl">Competitor-Dominant</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${avgDensity.toFixed(4)}</div><div class="lbl">Avg Density</div></div>`;
  h += '</div>';

  // Graph Metrics Table
  if(Object.keys(graphs).length) {
    h += '<h3>Graph Metrics Breakdown</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Graph</th><th>Nodes</th><th>Edges</th><th>Density</th><th>Components</th><th>Brand Nodes</th><th>Source Nodes</th><th>Model Nodes</th></tr></thead><tbody>';
    Object.entries(graphs).forEach(([name,data])=>{
      h += `<tr><td><strong>${name.replace(/_/g,' ')}</strong></td><td>${fmt(data.nodes)}</td><td>${fmt(data.edges)}</td><td>${(data.density||0).toFixed(4)}</td><td>${fmt(data.components)}</td><td>${fmt(data.brand_nodes||0)}</td><td>${fmt(data.source_nodes||0)}</td><td>${fmt(data.model_nodes||0)}</td></tr>`;
    });
    h += '</tbody></table></div>';

    // Top brands by PageRank
    Object.entries(graphs).forEach(([name,data])=>{
      if(data.top_brands_by_pagerank && data.top_brands_by_pagerank.length) {
        h += `<h4>Top Brands by PageRank (${name.replace(/_/g,' ')})</h4>`;
        h += '<div class="res-kpi-row">';
        data.top_brands_by_pagerank.forEach(([node,rank])=>{
          const brand=node.replace('brand:','');
          h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${rank.toFixed(4)}</div><div class="lbl">${brand}</div></div>`;
        });
        h += '</div>';
      }
      if(data.top_sources_by_centrality && data.top_sources_by_centrality.length) {
        h += `<h4>Top Citation Sources by Centrality (${name.replace(/_/g,' ')})</h4>`;
        h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Source</th><th>Centrality</th><th></th></tr></thead><tbody>';
        data.top_sources_by_centrality.slice(0,10).forEach(([node,cen])=>{
          const domain=node.replace('source:','');
          h += `<tr><td><strong>${domain}</strong></td><td>${cen.toFixed(4)}</td><td><div class="res-bar" style="width:120px"><div class="fill" style="width:${(cen*100).toFixed(0)}%;background:var(--blue)"></div></div></td></tr>`;
        });
        h += '</tbody></table></div>';
      }
    });

    // Graph density insights
    Object.entries(graphs).forEach(([name,data])=>{
      if(data.density>0.5) h += insight(`<strong>${name.replace(/_/g,' ')}</strong>: High density (${(data.density||0).toFixed(3)}) - strong interconnection between citation sources.`, 'success');
      else if(data.density<0.1&&data.nodes>0) h += insight(`<strong>${name.replace(/_/g,' ')}</strong>: Low density (${(data.density||0).toFixed(3)}) - sparse citation network with opportunity for growth.`, 'warn');
    });
  }

  // Missing Authority Nodes
  if(missing.length) {
    h += '<h3>Missing Authority Nodes</h3>';
    h += deepAnalysis(`These sources are cited by LLMs for competitor brands but have no \ presence. Each missing node represents an opportunity to capture citation volume. ${missing.length} gaps identified.`);
    missing.slice(0,10).forEach(n=>{
      h += `<div class="res-insight danger"><strong>${n.domain}</strong> &mdash; Weight: ${fmt(n.weight)} | Competitor: ${n.competitor||'-'} | Authority: ${n.authority_weight||'-'}<div style="font-size:.78em;color:var(--text2);margin-top:2px">Establish presence here to capture citation volume from this high-authority source.</div></div>`;
    });
  }

  // Competitor-Dominant Sources
  if(compDom.length) {
    h += '<h3>Competitor-Dominant Sources</h3>';
    compDom.slice(0,8).forEach(s=>{
      h += insight(`<strong>${s}</strong> - Currently dominated by competitor citations. Focus on mention-building and content creation on this platform.`, 'warn');
    });
  }

  // Your Citation Sources
  if(yourSources.length) {
    h += '<h3>Your Citation Sources (Shared with Competitors)</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Domain</th><th>Also Cites</th><th>Weight</th></tr></thead><tbody>';
    yourSources.slice(0,10).forEach(src=>{
      h += `<tr><td><strong>${src.domain}</strong></td><td>${src.also_cites_competitor}</td><td>${fmt(src.weight)}</td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 6: EMBEDDINGS & SEMANTIC ANALYSIS
// ══════════════════════════════════════════════════════════════
function renderSection6(s) {
  const emb=s.embedding_analysis||{};
  const bvp=emb.brand_vector_profiles||{};
  const crossSim=emb.cross_model_similarity||{};
  const drift=emb.semantic_drift||[];
  const clusters=emb.embedding_clusters||[];
  const topicEmb=emb.topic_embeddings||{};
  const textStats=emb.text_statistics||{};
  const byModel=textStats.responses_by_model||{};
  const byTurn=textStats.responses_by_turn||{};
  const lengthDist=textStats.length_distribution||{};

  let h = sectionHeader(6, 'Embedding & Semantic Vector Analysis', `Semantic positioning of each brand across LLMs using ${emb.model_used||'N/A'} embeddings. ${emb.total_responses_analyzed||0} responses analyzed.`, '');

  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${tag(emb.model_used||'-','blue')}</div><div class="lbl">Embedding Model</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(emb.total_responses_analyzed)}</div><div class="lbl">Responses Analyzed</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(Object.keys(bvp).length)}</div><div class="lbl">Brand Vector Profiles</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${fmt(clusters.length)}</div><div class="lbl">UMAP Clusters</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(textStats.total_responses)}</div><div class="lbl">Total Responses</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(textStats.avg_response_length?.toFixed(0))}</div><div class="lbl">Avg Length (chars)</div></div>`;
  h += '</div>';

  // Brand Vector Profiles
  if(Object.keys(bvp).length) {
    h += '<h3>Brand Vector Profiles</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Brand</th><th>Chunks</th><th>Intra-Similarity</th><th>Std Dev</th><th>Consistency</th></tr></thead><tbody>';
    Object.entries(bvp).sort((a,b)=>(b[1].mean_intra_similarity||0)-(a[1].mean_intra_similarity||0)).forEach(([br,prof])=>{
      const sim=prof.mean_intra_similarity||0;
      const consistency=sim>0.8?'High':sim>0.6?'Medium':'Low';
      const clr=consistency==='High'?'var(--green)':consistency==='Medium'?'var(--yellow)':'var(--red)';
      h += `<tr\$\{br === pb?' class="brand-row"':''}><td><strong>${br}</strong></td><td>${fmt(prof.num_chunks)}</td><td style="font-weight:600;color:${clr}">${sim.toFixed(4)}</td><td>${(prof.std_intra_similarity||0).toFixed(4)}</td><td><span style="color:${clr};font-weight:600">${consistency}</span></td></tr>`;
    });
    h += '</tbody></table></div>';
    h += deepAnalysis(`Intra-similarity measures how consistently LLMs describe each brand. >0.8 = High consistency. Low consistency = conflicting info across models, leading to unpredictable AI search behavior.`);
  }

  // Cross-Model Similarity
  if(Object.keys(crossSim).length) {
    h += '<h3>Cross-Model Semantic Similarity</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Model Pair</th><th>Cosine Similarity</th><th>Interpretation</th></tr></thead><tbody>';
    Object.entries(crossSim).sort((a,b)=>(b[1].cosine_similarity||0)-(a[1].cosine_similarity||0)).forEach(([pair,data])=>{
      const sim=data.cosine_similarity||0;
      const clr=sim>0.95?'var(--green)':sim>0.9?'var(--blue)':sim>0.8?'var(--yellow)':'var(--red)';
      h += `<tr><td><strong>${pair.replace(/_vs_/g,' vs ')}</strong></td><td style="color:${clr};font-weight:700">${(sim*100).toFixed(2)}%</td><td>${data.interpretation||'-'}</td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  // Semantic Drift
  if(drift.length) {
    h += '<h3>Semantic Drift Analysis</h3>';
    h += deepAnalysis(`Semantic drift measures how different each brand's LLM description is from \. High drift = LLMs associate very different attributes.`);
    drift.slice(0,8).forEach(d=>{
      const severity=d.drift_score>0.15?'danger':d.drift_score>0.08?'warn':'success';
      h += `<div class="res-insight ${severity}"><strong>${d.primary_brand_vs||d.brand_a_vs||''}</strong> &mdash; Cosine: <strong>${(d.cosine_similarity||0).toFixed(4)}</strong> | Drift: <strong>${(d.drift_score||0).toFixed(4)}</strong><div style="font-size:.78em;color:var(--text2);margin-top:2px">${d.interpretation||''}</div></div>`;
    });
  }

  // Topic Embeddings
  if(Object.keys(topicEmb).length) {
    h += '<h3>Topic Embeddings</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Topic</th><th>Samples</th><th>Intra-Similarity</th></tr></thead><tbody>';
    Object.entries(topicEmb).forEach(([topic,data])=>{
      h += `<tr><td><strong>${topic.replace(/_/g,' ')}</strong></td><td>${fmt(data.num_samples)}</td><td>${(data.intra_similarity||0).toFixed(4)}</td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  // Text Statistics deep dive
  if(textStats.total_responses) {
    h += '<h3>Response Text Statistics</h3>';
    h += '<div class="res-kpi-row">';
    h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(textStats.total_responses)}</div><div class="lbl">Total Responses</div></div>`;
    h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(textStats.avg_response_length?.toFixed(0))}</div><div class="lbl">Avg Length (chars)</div></div>`;
    h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${fmt(textStats.median_response_length?.toFixed(0))}</div><div class="lbl">Median Length</div></div>`;
    h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(textStats.std_response_length?.toFixed(0))}</div><div class="lbl">Std Dev</div></div>`;
    h += '</div>';

    // Length Distribution
    if(Object.keys(lengthDist).length) {
      h += '<h4>Response Length Distribution</h4><div class="res-kpi-row">';
      Object.entries(lengthDist).forEach(([k,v])=>{
        h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(v?.toFixed(0))}</div><div class="lbl">${k.toUpperCase()}</div></div>`;
      });
      h += '</div>';
    }

    // By Model breakdown
    if(Object.keys(byModel).length) {
      h += '<h4>Response Length by Model</h4>';
      h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Model</th><th>Count</th><th>Avg Length</th><th></th></tr></thead><tbody>';
      const maxLen=Object.values(byModel).reduce((m,d)=>Math.max(m,d.avg_length||0),1);
      Object.entries(byModel).forEach(([m,d])=>{
        h += `<tr><td><strong>${m}</strong></td><td>${fmt(d.count)}</td><td>${(d.avg_length||0).toFixed(0)}</td><td><div class="res-bar" style="width:120px"><div class="fill" style="width:${((d.avg_length||0)/maxLen*100).toFixed(0)}%;background:var(--blue)"></div></div></td></tr>`;
      });
      h += '</tbody></table></div>';
    }

    // By Turn Type
    if(Object.keys(byTurn).length) {
      h += '<h4>Response Length by Turn Type</h4>';
      h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Turn Type</th><th>Count</th><th>Avg Length</th></tr></thead><tbody>';
      Object.entries(byTurn).forEach(([t,d])=>{
        h += `<tr><td><strong>${t.replace(/_/g,' ')}</strong></td><td>${fmt(d.count)}</td><td>${(d.avg_length||0).toFixed(0)}</td></tr>`;
      });
      h += '</tbody></table></div>';
    }
  }

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 7: SENTIMENT & HALLUCINATION
// ══════════════════════════════════════════════════════════════
function renderSection7(s) {
  const sent=s.sentiment_matrix||{};
  const smSum=sent.sentiment_summary||{};
  const bsm=sent.brand_sentiment_matrix||{};
  const msm=sent.model_sentiment_matrix||{};
  const tse=sent.turn_sentiment_evolution||{};
  const npc=sent.negative_pattern_clusters||[];

  let h = sectionHeader(7, 'Sentiment & Hallucination Matrix', `Brand sentiment analysis across ${Object.keys(msm).length} models and ${Object.keys(tse).length} conversation turns.`, '');

  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${fmt(sent.total_analyzed)}</div><div class="lbl">Responses Analyzed</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(sent.detected_biases?.length||0)}</div><div class="lbl">Biases Detected</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${fmt(sent.hallucination_signals?.length||0)}</div><div class="lbl">Hallucination Signals</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${fmt(npc.length)}</div><div class="lbl">Negative Patterns</div></div>`;
  h += '</div>';

  // Sentiment Rankings
  if(smSum.most_positively_perceived) {
    h += '<h3>Sentiment Rankings</h3><div class="res-kpi-row">';
    h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${smSum.most_positively_perceived}</div><div class="lbl">Most Positive</div></div>`;
    h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${smSum.most_negatively_perceived}</div><div class="lbl">Most Negative</div></div>`;
    h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">#${smSum.primary_brand_sentiment_rank||smSum.brand_a_sentiment_rank||'-'}</div><div class="lbl">${pb} Rank</div></div>`;
    h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${smSum.total_biases_detected||0}</div><div class="lbl">Total Biases</div></div>`;
    h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${smSum.total_hallucination_signals||0}</div><div class="lbl">Hallucinations</div></div>`;
    h += '</div>';
  }

  // Brand Sentiment Matrix
  if(Object.keys(bsm).length) {
    h += '<h3>Brand Sentiment Matrix</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Brand</th><th>Positive Rate</th><th>Negative Rate</th><th>Neutral Rate</th><th>Mean Score</th><th>Std Dev</th><th>Mentions</th><th></th></tr></thead><tbody>';
    Object.entries(bsm).forEach(([br,st])=>{
      const posW=(st.positive_rate||0)*100;
      h += `<tr\$\{br === pb?' class="brand-row"':''}><td><strong>${br}</strong></td><td style="color:var(--green)">${pct(st.positive_rate)}</td><td style="color:var(--red)">${pct(st.negative_rate)}</td><td>${pct(st.neutral_rate)}</td><td>${(st.mean_sentiment_score||0).toFixed(3)}</td><td>${(st.std_sentiment_score||0).toFixed(3)}</td><td>${fmt(st.total_mentions)}</td><td><div class="res-bar" style="width:100px"><div class="fill" style="width:${posW}%;background:${posW>50?'var(--green)':posW>30?'var(--yellow)':'var(--red)'}"></div></div></td></tr>`;
    });
    h += '</tbody></table></div>';
  }

  // Sentiment by Model
  if(Object.keys(msm).length) {
    h += '<h3>Sentiment by Model</h3>';
    const sentBrands=new Set();
    Object.values(msm).forEach(d=>Object.keys(d).forEach(b=>sentBrands.add(b)));
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Model</th>';
    [...sentBrands].sort().forEach(b=>{h += `<th>${b} Pos</th><th>${b} Neg</th><th>${b} Neutral</th>`});
    h += '</tr></thead><tbody>';
    Object.entries(msm).forEach(([m,d])=>{
      h += `<tr><td><strong>${m}</strong></td>`;
      [...sentBrands].sort().forEach(b=>{
        const st=d[b]||{};
        h += `<td style="color:var(--green)">${pct(st.positive_rate)}</td><td style="color:var(--red)">${pct(st.negative_rate)}</td><td>${pct(st.neutral_rate)}</td>`;
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
  }

  // Turn Sentiment Evolution
  if(Object.keys(tse).length) {
    h += '<h3>Sentiment Evolution Across Turns</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Turn</th><th>Brand</th><th>Mean Sentiment</th><th>Std Dev</th><th>Samples</th><th>Negative Rate</th></tr></thead><tbody>';
    Object.entries(tse).forEach(([turn, brands])=>{
      Object.entries(brands).forEach(([br,st])=>{
        const sentClr=st.mean_sentiment>0.6?'var(--green)':st.mean_sentiment<0.4?'var(--red)':'var(--yellow)';
        h += `<tr><td><strong>${turn}</strong></td><td>${br}</td><td style="color:${sentClr};font-weight:600">${(st.mean_sentiment||0).toFixed(3)}</td><td>${(st.std_sentiment||0).toFixed(3)}</td><td>${fmt(st.sample_size)}</td><td>${(st.negative_rate*100).toFixed(1)}%</td></tr>`;
      });
    });
    h += '</tbody></table></div>';
    h += deepAnalysis(`Sentiment trajectory reveals documentation depth: improving sentiment across turns = strong deep docs. Degrading sentiment = surface content strong but deep docs weak.`);
  }

  // Negative Pattern Clusters
  if(npc.length) {
    h += '<h3>Negative Pattern Clusters</h3>';
    Object.values(npc).flat().forEach(cluster=>{
      const models=(cluster.models||[]).join(', ');
      const examples=(cluster.examples||[]).slice(0,2);
      h += `<div class="res-insight danger" style="margin-bottom:8px"><strong>${cluster.brand}</strong> &mdash; <code>${cluster.pattern}</code> (${cluster.count} occurrences)<div style="font-size:.72em;color:var(--text2);margin-top:2px">Models: ${models}</div>${examples.map(e=>`<div class="res-quote">${e.substring(0,200)}${e.length>200?'...':''}</div>`).join('')}</div>`;
    });
  }

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 8: BIASES & HALLUCINATIONS
// ══════════════════════════════════════════════════════════════
function renderSection8(s) {
  const sent=s.sentiment_matrix||{};
  const biases=sent.detected_biases||[];
  const hs=sent.hallucination_signals||[];
  const smSum=sent.sentiment_summary||{};
  if(!biases.length&&!hs.length){
    return sectionHeader(8, 'Detected Biases & Hallucination Patterns', 'No bias patterns or hallucination signals were flagged in this dataset.', '') +
      '<div class="res-section-body">' + insight('No biases or hallucinations detected in the analyzed responses. This module activates automatically when the sentiment engine flags systematic patterns (e.g. your brand consistently losing attribution to competitors, or hallucinated attribute claims).', 'success') + '</div></div>';
  }

  let h = sectionHeader(8, 'Detected Biases & Hallucination Patterns', `${biases.length} bias patterns and ${hs.length} hallucination signals detected across all models.`, '');

  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${biases.filter(b=>b.severity==='HIGH').length}</div><div class="lbl">HIGH Severity</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${biases.filter(b=>b.severity==='MEDIUM').length}</div><div class="lbl">MEDIUM Severity</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${biases.filter(b=>b.severity==='LOW').length}</div><div class="lbl">LOW Severity</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--purple)">${hs.length}</div><div class="lbl">Hallucination Signals</div></div>`;
  const totalBiasCount=biases.reduce((s,b)=>s+b.occurrence_count,0);
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${fmt(totalBiasCount)}</div><div class="lbl">Total Occurrences</div></div>`;
  h += '</div>';

  // All Biases Table
  if(biases.length) {
    h += '<h3>All Detected Biases</h3>';
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Brand</th><th>Pattern</th><th>Severity</th><th>Occurrences</th><th>Remediation</th></tr></thead><tbody>';
    biases.sort((a,b)=>{const s={HIGH:0,MEDIUM:1,LOW:2};return(s[a.severity]||3)-(s[b.severity]||3)||b.occurrence_count-a.occurrence_count}).forEach(b=>{
      const sevCls=b.severity==='HIGH'?'high':b.severity==='MEDIUM'?'med':'low';
      h += `<tr><td><strong>${b.brand}</strong></td><td>${b.pattern_display||b.bias_pattern}</td><td>${tag(b.severity,sevCls)}</td><td>${fmt(b.occurrence_count)}</td><td style="font-size:.78em;color:var(--text2)">${b.remediation||'-'}</td></tr>`;
    });
    h += '</tbody></table></div>';

    // Critical Biases
    const critical=smSum.critical_biases||[];
    if(critical.length) {
      h += '<h3>Critical Biases (Highest Impact)</h3>';
      critical.forEach(b=>{
        h += `<div class="res-insight danger"><strong>${b.brand}</strong> &mdash; ${b.pattern_display} ${tag(b.severity,'high')} (${b.occurrence_count} occurrences)<div style="font-size:.78em;color:var(--text2);margin-top:3px"><strong>Remediation:</strong> ${b.remediation}</div></div>`;
      });
    }
  }

  // Hallucination Signals
  if(hs.length) {
    h += '<h3>Hallucination Signals</h3>';
    h += deepAnalysis('Hallucination signals indicate conflicting or unverifiable claims across models. These can damage credibility when buyers research via AI search.');
    hs.forEach(hh=>{
      h += `<div class="res-insight warn"><strong>${hh.brand}</strong> &mdash; ${hh.claim_type} ${tag(hh.confidence,'blue')} (${hh.occurrence_count} occurrences)<div style="font-size:.78em;color:var(--text2);margin-top:3px"><strong>Conflicting Claims:</strong> ${(hh.conflicting_claims||[]).join('; ')}</div><div style="font-size:.78em;color:var(--text2)"><strong>Models Reporting:</strong> ${(hh.models_reporting||[]).join(', ')}</div><div style="font-size:.78em;color:var(--text2)"><strong>Action:</strong> ${hh.action||'-'}</div></div>`;
    });
  }

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 9: RECOMMENDATIONS
// ══════════════════════════════════════════════════════════════
function renderSection9(s) {
  const recs=s.recommendations||[];
  if(!recs.length){
    return sectionHeader(9, 'Strategic Recommendations', 'No prioritized action items were generated for this dataset.', '') +
      '<div class="res-section-body">' + insight('The recommendation engine generates HIGH/MEDIUM/LOW actions from the real module findings (SoMV gaps, biases, citation deficits, crawler blocks, CPR decay). Re-run with more records or richer citation data to surface actionable items.', 'warn') + '</div></div>';
  }

  let h = sectionHeader(9, 'Strategic Recommendations', `${recs.length} prioritized action items computed from real-time analysis of your data.`, '');

  h += '<div class="res-kpi-row">';
  h += `<div class="res-kpi"><div class="val" style="color:var(--red)">${recs.filter(r=>r.priority==='HIGH').length}</div><div class="lbl">High Priority</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--yellow)">${recs.filter(r=>r.priority==='MEDIUM').length}</div><div class="lbl">Medium Priority</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--green)">${recs.filter(r=>r.priority==='LOW').length}</div><div class="lbl">Low Priority</div></div>`;
  h += `<div class="res-kpi"><div class="val" style="color:var(--blue)">${recs.filter(r=>r.priority==='INFO').length}</div><div class="lbl">Info</div></div>`;
  h += '</div>';

  // Grouped by category
  const categories = {};
  recs.forEach(r => {
    const cat = r.category || 'General';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(r);
  });

  if(Object.keys(categories).length > 1) {
    h += '<h3>Recommendations by Category</h3>';
    Object.entries(categories).sort((a,b) => b[1].length - a[1].length).forEach(([cat, items]) => {
      const highCount = items.filter(r => r.priority === 'HIGH').length;
      h += `<h4>${cat} (${items.length} items${highCount ? `, ${highCount} HIGH` : ''})</h4>`;
      items.sort((a,b) => {const p={HIGH:0,MEDIUM:1,LOW:2,INFO:3};return(p[a.priority]||4)-(p[b.priority]||4)}).forEach((r,i) => {
        const cls=r.priority==='HIGH'?'danger':r.priority==='MEDIUM'?'warn':'success';
        const pillCls=r.priority==='HIGH'?'high':r.priority==='MEDIUM'?'med':r.priority==='LOW'?'low':'blue';
        h += `<div class="res-insight ${cls}" style="margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="font-weight:700;font-size:.85em">#${i+1}</span>
            ${tag(r.priority,pillCls)}
            ${r.model?`<span style="font-size:.72em;color:var(--text2)">${r.model}</span>`:''}
            ${r.estimated_impact?`<span style="font-size:.72em;color:var(--text2)">Impact: ${tag(r.estimated_impact,'blue')}</span>`:''}
          </div>
          <div style="font-weight:600;margin-bottom:2px">${r.finding||''}</div>
          <div style="font-size:.8em;color:var(--text2)"><strong>Action:</strong> ${r.action||''}</div>
        </div>`;
      });
    });
  } else {
    recs.sort((a,b)=>{const p={HIGH:0,MEDIUM:1,LOW:2,INFO:3};return(p[a.priority]||4)-(p[b.priority]||4)}).forEach((r,i)=>{
      const cls=r.priority==='HIGH'?'danger':r.priority==='MEDIUM'?'warn':'success';
      const pillCls=r.priority==='HIGH'?'high':r.priority==='MEDIUM'?'med':r.priority==='LOW'?'low':'blue';
      h += `<div class="res-insight ${cls}" style="margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-weight:700;font-size:.85em">#${i+1}</span>
          ${tag(r.priority,pillCls)}
          <span style="font-size:.72em;color:var(--text2)">${r.category||''}</span>
          ${r.model?`<span style="font-size:.72em;color:var(--text2)">${r.model}</span>`:''}
          ${r.estimated_impact?`<span style="font-size:.72em;color:var(--text2)">Impact: ${tag(r.estimated_impact,'blue')}</span>`:''}
        </div>
        <div style="font-weight:600;margin-bottom:2px">${r.finding||''}</div>
        <div style="font-size:.8em;color:var(--text2)"><strong>Action:</strong> ${r.action||''}</div>
      </div>`;
    });
  }

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 10: CHARTS (delegated to renderCharts in index.html)
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// SECTION 10: ENTERPRISE INTELLIGENCE (Advanced Graph + Parity + CPR)
// ══════════════════════════════════════════════════════════════
function renderEnterprise(s) {
  const ei = s.enterprise_insights || {};
  const hasAny = Object.keys(ei).length > 0;
  if (!hasAny) {
    return sectionHeader(10, 'Enterprise Intelligence & Advanced Graph Analytics', 'Enterprise-grade metrics require the advanced analytics stage to have run.', '🧠') +
      '<div class="res-section-body">' + insight('This module computes parity calibration, multi-turn CPR, Graph Authority Score, inverse citation mapping, source ROI and remediation scripts from the analyzed records. No enterprise insight data was produced — re-run the pipeline after the ingestion fixes.', 'warn') + '</div></div>';
  }

  let h = sectionHeader(10, 'Enterprise Intelligence & Advanced Graph Analytics',
    'Real computations: API vs web-UI parity calibration, multi-turn Citation Persistence Rate, Graph Authority Score, inverse citation mapping, source-level ROI, and auto-generated remediation scripts.', '🧠');

  // ── 1. Parity Calibration ──
  const parity = ei.parity_calibration || {};
  h += '<h3>1. API vs Web-UI Parity Calibration</h3>';
  if (parity.status === 'calibrated') {
    h += '<div class="res-kpi-row">';
    h += `<div class="res-kpi"><div class="val" style="color:${parity.mean_citation_variance > 0.15 ? 'var(--red)' : 'var(--green)'}">${(parity.mean_citation_variance * 100).toFixed(1)}%</div><div class="lbl">Mean Citation Variance</div></div>`;
    h += `<div class="res-kpi"><div class="val">${parity.paired_prompts || 0}</div><div class="lbl">Paired Control Prompts</div></div>`;
    h += `<div class="res-kpi"><div class="val">${(parity.max_citation_variance * 100).toFixed(1)}%</div><div class="lbl">Max Variance</div></div>`;
    h += '</div>';
    if (parity.variance_flags && parity.variance_flags.length) {
      h += miniTable(
        ['Model', 'Turn', 'Variance', 'Finding'],
        parity.variance_flags.slice(0, 8).map(f => ({
          cells: [f.model, 'Turn ' + f.turn_index, (f.variance * 100).toFixed(1) + '%', f.finding]
        }))
      );
    }
  } else {
    h += insight((parity.message || 'No channel data to calibrate.') + ' <strong>Recommended:</strong> enable the 20% stealth-Playwright web-UI control group.', 'warn');
  }
  if (parity.calibration_advice && parity.calibration_advice.length) {
    h += deepAnalysis('Calibration advice: ' + parity.calibration_advice.join(' '));
  }

  // ── 2. Multi-Turn CPR ──
  const cpr = ei.multi_turn_cpr || {};
  h += '<h3>2. Multi-Turn Citation Persistence Rate (CPR)</h3>';
  if (cpr.overall_cpr != null) {
    h += '<div class="res-kpi-row">';
    const cprColor = cpr.overall_cpr >= 0.6 ? 'var(--green)' : cpr.overall_cpr >= 0.4 ? 'var(--yellow)' : 'var(--red)';
    h += `<div class="res-kpi"><div class="val" style="color:${cprColor}">${(cpr.overall_cpr * 100).toFixed(0)}%</div><div class="lbl">Overall CPR</div></div>`;
    h += `<div class="res-kpi"><div class="val">${Object.keys(cpr.cpr_by_model || {}).length}</div><div class="lbl">Models Tracked</div></div>`;
    h += `<div class="res-kpi"><div class="val">${(cpr.token_window_signals || []).length}</div><div class="lbl">Truncation Signals</div></div>`;
    h += '</div>';
    if (Object.keys(cpr.cpr_by_model || {}).length) {
      h += miniTable(
        ['Model', 'CPR', 'Status'],
        Object.entries(cpr.cpr_by_model).map(([m, v]) => ({
          cells: [m, (v * 100).toFixed(0) + '%', v >= 0.6 ? 'Healthy' : v >= 0.4 ? 'At Risk' : 'Critical']
        }))
      );
    }
  } else {
    h += insight((cpr.message || 'No multi-turn data available for CPR analysis.'), 'warn');
  }
  if (cpr.token_window_signals && cpr.token_window_signals.length) {
    cpr.token_window_signals.slice(0, 5).forEach(sig => {
      h += insight(sig.finding + ` (~${(sig.estimated_context_tokens / 1000).toFixed(0)}k chars context)`, 'danger');
    });
  }

  // ── 3. Graph Authority Score ──
  const ga = ei.graph_authority || {};
  h += '<h3>3. Graph Authority Score</h3>';
  if (ga.scores && ga.scores.length) {
    h += `<div class="res-deep" style="font-family:monospace;font-size:.74em">G_auth = α·C<sub>D</sub>(v) + β·C<sub>B</sub>(v) + γ·S<sub>cos</sub>(E_brand, E_intent) &nbsp;|&nbsp; α=${ga.coefficients.alpha_in_degree}, β=${ga.coefficients.beta_betweenness}, γ=${ga.coefficients.gamma_similarity}</div>`;
    const brandRows = ga.scores.filter(r => r.type === 'brand').slice(0, 10);
    if (brandRows.length) {
      h += miniTable(
        ['Rank', 'Brand', 'In-Degree', 'Betweenness', 'Cosine Sim', 'Authority Score'],
        brandRows.map((r, i) => ({
          cells: ['#' + (i + 1), r.name, r.in_degree_centrality, r.betweenness_centrality, r.cosine_similarity, r.graph_authority_score],
          cls: r.name === getPrimaryBrand(s) ? 'brand-row' : ''
        }))
      );
    }
    h += miniTable(
      ['Type', 'Node', 'Authority Score'],
      ga.scores.slice(0, 12).map(r => ({
        cells: [r.type, r.name, r.graph_authority_score],
        cls: r.type === 'brand' ? 'brand-row' : ''
      }))
    );
  } else {
    h += insight(ga.message || 'No graph data for authority scoring.', 'warn');
  }

  // ── 4. Inverse Citation Mapping ──
  const ic = ei.inverse_citation || {};
  h += '<h3>4. Inverse Citation Mapping & Crawler Blockage</h3>';
  const unctd = ic.uncited_authority || [];
  if (unctd.length) {
    h += miniTable(
      ['Domain', 'Competitor', 'Weight', 'Authority Weight'],
      unctd.slice(0, 10).map(n => ({
        cells: [n.domain, n.competitor || '-', n.weight, n.authority_weight || '-']
      }))
    );
  } else {
    h += insight('No uncited authority nodes detected in this dataset.', 'success');
  }
  if (ic.crawler_blockage && ic.crawler_blockage.length) {
    h += '<h4>LLM Crawler robots.txt Audit</h4>';
    ic.crawler_blockage.forEach(cb => {
      if (cb.crawler === 'check_failed') h += insight(cb.detail, 'warn');
      else if (cb.disallowed) h += insight(`⚠ ${cb.crawler} appears blocked in robots.txt — <strong>Citation Omission due to Crawler Blockage.</strong> ${cb.detail}`, 'danger');
      else h += insight(`✓ ${cb.crawler}: ${cb.detail}`, 'success');
    });
  }

  // ── 5. Source-Level ROI ──
  const roi = ei.source_roi || {};
  h += '<h3>5. Source-Level ROI Prioritization</h3>';
  if (roi.ranked_sources && roi.ranked_sources.length) {
    const top = roi.ranked_sources.slice(0, 12);
    const maxW = Math.max(...top.map(r => r.citation_influence_weight), 1);
    h += '<div class="res-table-wrap"><table class="res-table"><thead><tr><th>Domain</th><th>Citations</th><th>Models</th><th>Authority</th><th>Your Share</th><th>Influence Weight</th></tr></thead><tbody>';
    top.forEach(r => {
      h += `<tr><td style="font-weight:600">${r.domain}</td><td>${r.citation_count}</td><td>${r.model_diversity}</td><td>${r.authority_weight}</td><td>${(r.your_brand_share * 100).toFixed(0)}%</td><td><div class="res-bar" style="width:120px;display:inline-block;vertical-align:middle"><div class="fill" style="width:${(r.citation_influence_weight / maxW * 100).toFixed(0)}%;background:linear-gradient(90deg,#1a73e8,#7c3aed)"></div></div><span style="margin-left:6px;font-weight:700">${r.citation_influence_weight}</span></td></tr>`;
    });
    h += '</tbody></table></div>';
    (roi.concentration_alerts || []).forEach(a => {
      h += insight(`<strong>${(a.share * 100).toFixed(0)}% of citations from ${a.domains.length} sources.</strong> ${a.finding}`, 'warn');
    });
  }

  // ── 6. Remediation Scripts ──
  const sgr = ei.semantic_gap_remediation || {};
  h += '<h3>6. Semantic Gap Remediation Scripts</h3>';
  const scripts = sgr.remediation_scripts || [];
  if (scripts.length) {
    h += `<p style="font-size:.8em;color:var(--text2);margin-bottom:10px">${scripts.length} ready-to-publish assets auto-generated from your real data gaps.</p>`;
    scripts.slice(0, 5).forEach((sc, i) => {
      const typeCls = sc.type === 'negative_claim_faq' ? 'danger' : sc.type === 'authority_outreach' ? 'blue' : 'med';
      h += `<div class="res-insight ${typeCls}" style="margin-bottom:10px">
        <div style="font-weight:700;margin-bottom:4px">${i + 1}. ${sc.title}</div>
        <div style="font-size:.8em;color:var(--text2);margin-bottom:6px"><strong>Target:</strong> ${sc.target_page}</div>
        <div style="font-size:.78em;background:rgba(0,0,0,.04);border-radius:8px;padding:8px 10px;margin-bottom:6px;white-space:pre-wrap;font-family:monospace;max-height:110px;overflow:hidden">${sc.jsonld.replace(/</g, '&lt;')}</div>
        <div style="font-size:.78em;color:var(--text2);white-space:pre-wrap">${sc.markdown}</div>
      </div>`;
    });
  } else {
    h += insight('No remediation scripts generated (no negative triples or missing sources in this dataset).', 'success');
  }

  // ── 7. SoMV Trendlines ──
  const trend = ei.somv_trendlines || {};
  h += '<h3>7. SoMV Trendlines by Model Family & Funnel Stage</h3>';
  if (Object.keys(trend.by_model_family || {}).length) {
    h += '<h4>By Model Family (primary recommendation share)</h4>';
    const famRows = [];
    Object.entries(trend.by_model_family).forEach(([fam, shares]) => {
      const pb = getPrimaryBrand(s);
      const mine = shares[pb] || 0;
      const leaders = Object.entries(shares).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, v]) => `${b} ${(v * 100).toFixed(0)}%`).join(', ');
      famRows.push({ cells: [fam, (mine * 100).toFixed(1) + '%', leaders], cls: 'brand-row' });
    });
    h += miniTable(['Model Family', 'Your Primary Share', 'Top Brands'], famRows);
  }
  if (Object.keys(trend.by_funnel_stage || {}).length) {
    h += '<h4>By Funnel Stage</h4>';
    const stageRows = Object.entries(trend.by_funnel_stage).map(([stage, shares]) => {
      const pb = getPrimaryBrand(s);
      const mine = shares[pb] || 0;
      return { cells: [stage, (mine * 100).toFixed(1) + '%'], cls: 'brand-row' };
    });
    h += miniTable(['Funnel Stage', 'Your Primary Share'], stageRows);
  }
  (trend.findings || []).forEach(f => h += insight(f, 'warn'));

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// SECTION 11: STRATEGIC SUMMARY
// ══════════════════════════════════════════════════════════════
function renderStrategicSummary(s) {
  const ts=s.triple_stats||{};
  const gs=s.graph_stats||{};
  const emb=s.embedding_analysis||{};
  const sent=s.sentiment_matrix||{};
  const sm=s.somv||{};
  const overall=sm.overall||{};
  const bs=overall.brand_stats||{};
  const recs=s.recommendations||[];
  const biases=sent.detected_biases||[];
  const hs=sent.hallucination_signals||{};
  const negTriplesKey = Object.keys(ts).find(k => k.startsWith('negative_triples_')) || '';
  const negTriples=ts[negTriplesKey]||[];
  const missing=(gs.missing_authority_nodes||[]);
  const brandA=bs[pb]||{};

  let h = sectionHeader('strategic', 'Strategic Summary & Action Plan', 'Consolidated health score and prioritized 4-phase action plan derived from all analysis modules.', '');

  // Health Score computation
  let healthScore = 0;
  if(brandA.share_of_voice) healthScore += brandA.share_of_voice * 30;
  if(brandA.primary_recommendation_rate) healthScore += brandA.primary_recommendation_rate * 25;
  if(brandA.omission_rate != null) healthScore += (1 - brandA.omission_rate) * 20;
  const posRate = (sent.brand_sentiment_matrix||{})[pb] || (sent.brand_sentiment_matrix||{})[Object.keys(sent.brand_sentiment_matrix||{})[0]];
  if(posRate) healthScore += (posRate.positive_rate||0) * 15;
  if(biases.filter(b=>b.brand===pb&&b.severity==='HIGH').length === 0) healthScore += 10;
  healthScore = Math.min(100, Math.round(healthScore));
  const healthColor = healthScore > 70 ? 'var(--green)' : healthScore > 40 ? 'var(--yellow)' : 'var(--red)';
  const healthLabel = healthScore > 70 ? 'Strong Position' : healthScore > 40 ? 'Needs Improvement' : 'Critical Attention Required';

  h += `<div class="res-kpi-row">
    <div class="res-kpi" style="border:2px solid ${healthColor};background:${healthColor}11"><div class="val" style="color:${healthColor}">${healthScore}/100</div><div class="lbl">${healthLabel}</div></div>
    <div class="res-kpi"><div class="val" style="color:var(--blue)">${pct(brandA.share_of_voice||0)}</div><div class="lbl">Current SoMV</div></div>
    <div class="res-kpi"><div class="val" style="color:var(--red)">${negTriples.length}</div><div class="lbl">Negative Claims</div></div>
    <div class="res-kpi"><div class="val" style="color:var(--yellow)">${biases.filter(b=>b.severity==='HIGH').length}</div><div class="lbl">Critical Biases</div></div>
    <div class="res-kpi"><div class="val" style="color:var(--purple)">${missing.length}</div><div class="lbl">Missing Authority Sources</div></div>
    <div class="res-kpi"><div class="val" style="color:var(--green)">${fmt(recs.length)}</div><div class="lbl">Total Recommendations</div></div>
  </div>`;

  // Phase 1: Emergency Response
  h += '<h3>Phase 1: Emergency Response (Week 1-2)</h3>';
  h += '<div class="res-impl-guide"><ol style="margin:0;padding-left:20px">';
  if(hs.length) h += `<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Hallucination fix:</strong> Create documentation countering ${hs.length} hallucination signals. Priority: models with fastest content turnover.</li>`;
  if(biases.filter(b=>b.severity==='HIGH').length) h += `<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Critical bias response:</strong> Counter ${biases.filter(b=>b.severity==='HIGH').length} HIGH-severity biases with targeted content creation.</li>`;
  if(negTriples.length) h += `<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Negative triple content:</strong> Create FAQ pages for ${negTriples.length} negative claims found in LLM responses.</li>`;
  if(missing.length) h += `<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Missing authority nodes:</strong> Establish presence on ${missing.length} sources where competitors are cited but ${pb} is absent.</li>`;
  h += '</ol></div>';

  // Phase 2: Foundation
  h += '<h3>Phase 2: Foundation (Month 1)</h3>';
  h += '<div class="res-impl-guide"><ol style="margin:0;padding-left:20px">';
  h += '<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Schema overhaul:</strong> Implement FAQ, Product, TechArticle, and comparison table schema on all key pages.</li>';
  h += '<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Content alignment:</strong> Rewrite content to match what LLMs consider optimal answers based on embedding analysis.</li>';
  h += '<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Crawler audit:</strong> Verify GPTBot, ClaudeBot, PerplexityBot, Google-Extended access in robots.txt.</li>';
  h += '</ol></div>';

  // Phase 3: Growth
  h += '<h3>Phase 3: Growth (Month 2-3)</h3>';
  h += '<div class="res-impl-guide"><ol style="margin:0;padding-left:20px">';
  h += '<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Model-specific targeting:</strong> Address weakest models identified in SoMV-by-model analysis.</li>';
  h += '<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Persona content:</strong> Create content targeting lowest-SoMV buyer personas from the persona analysis.</li>';
  h += '<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Third-party validation:</strong> Build presence on missing authority nodes and citation sources.</li>';
  h += '</ol></div>';

  // Phase 4: Ongoing
  h += '<h3>Phase 4: Sustained Excellence (Ongoing)</h3>';
  h += '<div class="res-impl-guide"><ol style="margin:0;padding-left:20px">';
  h += '<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Monthly re-analysis:</strong> Re-run full pipeline monthly to track SoMV, bias reduction, and citation graph changes.</li>';
  h += '<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Content freshness:</strong> Keep key pages under 3 months old. Update all documentation quarterly.</li>';
  h += '<li style="font-size:.82em;color:var(--text2);margin:6px 0"><strong>Competitive monitoring:</strong> Track competitor SoMV shifts across all models monthly.</li>';
  h += '</ol></div>';

  h += '</div>';
  return h;
}

// ══════════════════════════════════════════════════════════════
// 2026 ENTERPRISE TRUTH TABS — Google Truth / Surfaces / Fan-out / ACE / Crawl
// Per-surface + grounded-only + Wilson. Never averaged. All no_data-honest.
// ══════════════════════════════════════════════════════════════
function renderGoogleTruth(s) {
  const g = s.google_truth || {};
  const tj = s.traffic_join || {};
  let h = sectionHeader('google', 'Google Truth — Generative AI Report + Controls', 'OAuth API pull for the Generative AI performance report side-by-side with Web Performance, plus Search generative AI control audit. Web clicks include AI totals — delta ≠ causation.', '🔍');
  const files = g.files_present || {};
  const present = Object.entries(files).filter(([, v]) => v).map(([k]) => k);
  if (g.status === 'no_data') {
    h += insight('No Google Truth files yet. Run: <code>python scripts/gsc_genai_pull.py --audit-controls https://example.com/</code> + <code>--genai-csv/--web-csv</code>, or set GSC_OAUTH_* for the live API pull. ' + (g.message || ''), 'warn');
  } else {
    h += insight(`Google Truth sidecar: <strong>${present.join(', ') || 'files present'}</strong>. Fetch live: <code>GET /api/google-truth</code>.`, 'success');
  }
  const gate = tj.gsc_generative_gate || {};
  const ga = tj.ga4_ai_referrers || {};
  if (gate.status === 'measured') h += `<div class="res-kpi-row"><div class="res-kpi"><div class="val" style="color:var(--blue)">${(gate.generative_inclusion_rate * 100).toFixed(1)}%</div><div class="lbl">Generative Inclusion Rate</div></div><div class="res-kpi"><div class="val">${fmt(gate.converting_queries)}</div><div class="lbl">Converting Queries</div></div></div>`;
  if (ga.status === 'measured') h += `<div class="res-kpi-row"><div class="res-kpi"><div class="val" style="color:var(--green)">${(ga.ai_revenue_share * 100).toFixed(1)}%</div><div class="lbl">AI Revenue Share</div></div><div class="res-kpi"><div class="val">${(ga.ai_session_share * 100).toFixed(1)}%</div><div class="lbl">AI Session Share</div></div></div>`;
  h += deepAnalysis('<strong>Google 2026 rules encoded:</strong> AIO + AI Mode rooted in core Search ranking (RAG from Search index). Eligibility (indexed + snippet-eligible + tech reqs + generative inclusion) ≠ visibility. Myths killed: llms.txt, chunking, special AI schema, AI-rewrite. Controls: Search generative AI control (include default), page noindex vs nosnippet/max-snippet/data-nosnippet, Google-Extended = training only. No generated queries / reasoning / citation rank exposed. Zero-click: 92–94% AI Mode, 80–83% AIO.');
  h += '</div>';
  return h;
}

function renderSurfaces(s) {
  const sp = s.surface_split || {};
  let h = sectionHeader('surfaces', 'Surfaces — AIO vs AI Mode vs Gemini (Never Averaged)', 'AIO + AI Mode are 86% semantically similar but only 13.7% same URLs. Each surface gets its own SoMV / volatility / fan-out.', '🛰️');
  const per = sp.per_surface || {};
  const rows = Object.entries(per).filter(([, v]) => v.status === 'measured').map(([k, v]) => ({ cells: [k, v.n, v.grounded_n, (v.browse_rate * 100).toFixed(1) + '%', (v.flags || []).join(', ') || '—'] }));
  if (rows.length) h += miniTable(['Surface', 'n', 'Grounded n', 'Browse rate', 'Flags'], rows);
  else h += insight('No per-surface rows yet — ' + (sp.rule || 'collect AIO + AI Mode via SERP separately.'), 'warn');
  const ov = sp.aio_vs_aimode_overlap || {};
  if (ov.jaccard != null) h += deepAnalysis(`<strong>AIO vs AI Mode overlap:</strong> ${ov.shared} shared domains / ${ov.aio_domains} AIO + ${ov.ai_mode_domains} AI Mode (Jaccard ${(ov.jaccard * 100).toFixed(1)}%). ${ov.reference || ''}`);
  const vw = s.volume_weighted_somv || {};
  if (vw.weighted) h += insight(`<strong>Volume-weighted SoMV (demand-adjusted):</strong> ${Object.entries(vw.volume_weighted_somv || {}).slice(0, 5).map(([b, v]) => `${b} ${(v * 100).toFixed(1)}%`).join(' · ')} <span style="color:var(--text2)">(sources: ${(vw.volume_sources || []).join(', ')})</span>`, 'success');
  else h += insight('SoMV is UNWEIGHTED (theater warning). Run <code>python scripts/prompt_miner.py --gsc gsc.csv</code> for Prompt Volumes + Conversation Explorer-lite.', 'warn');
  h += '</div>';
  return h;
}

function renderFanout(s) {
  const ei = s.enterprise_insights || {};
  const rd = ei.retrieval_diagnostics || {};
  let h = sectionHeader('fanout', 'Query Fan-outs — Hidden Queries → Cited Domains', 'The fix-queries-not-copy insight: a hidden query that never surfaces in citations is a reformulation failure.', '🕸️');
  const rows = rd.per_prompt || rd.failures || rd.rows || [];
  if (rd.status === 'no_data' || !rows.length) {
    h += insight('No fan-out data. Enable <code>dynamic_search_context.capture_hidden_queries</code> (max_search_queries_per_prompt, query_templates, source_priority) and re-run. Live API: <code>GET /api/fanout</code>. ' + (rd.message || ''), 'warn');
  } else {
    h += miniTable(['Prompt', 'Hidden queries', 'Cited domains', 'Verdict'], rows.slice(0, 20).map((r) => ({ cells: [String(r.prompt || '').slice(0, 60), (r.hidden_queries || []).join('; ').slice(0, 80) || '—', (r.cited_domains || []).join(', ').slice(0, 80) || '—', r.reformulation_failure ? 'REFORMULATION FAILURE' : 'ok'] })));
  }
  h += '</div>';
  return h;
}

function renderACE(s) {
  const ace = s.ace_predictor || {};
  let h = sectionHeader('ace', 'ACE — Predictive Citation Probability (Prioritization, Not Prophecy)', 'Lightweight logistic model fitted on THIS run only: recency, stats, quotes, authority, snippet eligibility, fan-out overlap → P(cite) + uplift levers.', '🎯');
  const ranked = ace.ranked_lowest_first || [];
  if (ace.status !== 'ok' || !ranked.length) {
    h += insight('No ACE scores yet — pipeline emits ace_predictor from site-audit pages. ' + (ace.message || ''), 'warn');
  } else {
    h += miniTable(['Page (lowest P first)', 'P(cite)', 'Top lever (+Δ)'], ranked.slice(0, 15).map((r) => ({ cells: [String(r.url || '').slice(0, 60), r.p_cite, `${(r.levers || [])[0] ? r.levers[0].lever : '—'} (${(r.levers || [])[0] ? '+' + r.levers[0].delta_p_cite : ''})`] })));
    h += deepAnalysis('<strong>Honesty:</strong> P(cite) is a within-run prioritization score, not a Google guarantee. Eligibility ≠ visibility. Example lever: “add 1 stat + source = +X%”.');
  }
  h += '</div>';
  return h;
}

function renderCrawlTruth(s) {
  const c = s.crawl_truth || {};
  let h = sectionHeader('crawl', 'Crawl Truth — Bot Fetches + MCP/robots/llms.txt Probes', 'If you are blocked, you are invisible — and no SoMV number explains why without this. ChatGPT = Bing + OAI-SearchBot · Claude = Brave · Gemini = Google + YouTube 9.5% · Perplexity = Sonar + Reddit 6.6%.', '🤖');
  if (c.status === 'no_data') h += insight('No crawl_truth.json. Run: <code>python scripts/crawler_audit.py --site https://YOUR-SITE/ [--log access.log]</code>. Live: <code>GET /api/crawl</code>. OAI-SearchBot vs ChatGPT-User vs GPTBot vs PerplexityBot vs Google-Extended + robots/llms.txt probes. ' + (c.message || ''), 'warn');
  else h += insight('Crawl Truth present — see <code>GET /api/crawl</code> for per-bot hits + /.well-known/mcp.json + llms.txt (info-only, score 0) + robots probes.', 'success');
  const fc = s.factcheck || {};
  if (fc.status === 'ok') h += `<div class="res-kpi-row"><div class="res-kpi"><div class="val">${(fc.accuracy_intervention_rate * 100).toFixed(1)}%</div><div class="lbl">Accuracy Intervention Rate (bench 7.9%)</div></div><div class="res-kpi"><div class="val">${fc.needs_fix}/${fc.checked}</div><div class="lbl">Claims Needing Fix</div></div></div>`;
  else h += insight('FactCheck loop: ' + (fc.message || 'no claim feed yet — triples feed FactCheckLoop when present.') + ' Apply via <code>python scripts/remediation_pr.py --apply-factcheck</code> (PR drafts, never auto-publish).', 'warn');
  const mm = s.multimodal_truth || {};
  if (mm.status === 'no_data') h += insight('Multimodal/Merchant/Local: ' + (mm.message || 'run multimodal_merchant_audit.py for image alt, VideoObject/transcripts, GTIN/price/availability, GBP checklist.'), 'warn');
  else h += insight('Multimodal/Merchant/Local audit present.', 'success');
  h += '</div>';
  return h;
}

// ── P0/P1 enterprise views (2026-09): Trends hero, Volumes, Graveyard, Third-party, Commerce ──
function renderTrends(s) {
  let h = sectionHeader('trends', 'Trend Intelligence — 90-Day Memory (Not Point-in-Time)', 'Only 16% of brands track AI performance (McKinsey). Silent shortlists happen before the site visit. Live: GET /api/trends?days=90 (SQLite data/trends.db). Scheduler diffs: SoMV drop >15%, competitor surge >15%, CPR <50%, volatility HIGH.', '↗');
  h += `<div class="res-kpi-row"><div class="res-kpi"><div class="val">90d</div><div class="lbl">SoMV / CPR / Volatility Window</div></div><div class="res-kpi"><div class="val">>15%</div><div class="lbl">SoMV Drop Alert Threshold</div></div><div class="res-kpi"><div class="val">&lt;50%</div><div class="lbl">CPR Alert Floor</div></div></div>`;
  h += insight('Point-in-time SoMV is theater (AIO shifts ~70% on repeat). This tab reads <code>GET /api/trends?days=90</code>: run_snapshots series + alerts + EU/US geo splits + sentiment-model versions (VADER rows never compare to RoBERTa). Run 2+ daily cycles to populate.', '');
  h += deepAnalysis('How to use: schedule <code>npm run scheduler:daily</code> → each run upserts SoMV/CPR/volatility + citation_history + sentiment version. Slack webhook fires on SoMV drop >15% / competitor surge >15% / hallucination spike / CPR <50% / snippet-blocked / volatility HIGH. Configure <code>SLACK_WEBHOOK_URL</code> in server env (never in browser).');
  h += '</div>';
  return h;
}
function renderVolumes(s) {
  const v = s.volume_weighted_somv || {};
  let h = sectionHeader('volumes', 'Prompt Volumes — Volume-Weighted SoMV (Profound-Moat Answer)', 'Panel-free volumes: YOUR run history + GSC queries → volume-weighted SoMV. scripts/prompt_miner.py → prompt_volumes.json → analytics/prompt_volumes.py. Live: GET /api/prompt-volumes.', '⚖️');
  if (v.status !== 'ok') h += insight('No volume weighting yet. ' + (v.message || 'Run: python scripts/prompt_miner.py --gsc gsc.csv, then re-analyze.') + ' Unweighted SoMV treats every prompt equally — volumes fix that.', 'warn');
  else {
    h += miniTable(['Brand', 'Unweighted SoMV', 'Volume-weighted SoMV', 'Δ'], (v.brands || []).slice(0, 12).map((b) => ({ cells: [b.brand, (b.unweighted * 100).toFixed(1) + '%', (b.weighted * 100).toFixed(1) + '%', ((b.weighted - b.unweighted) * 100).toFixed(1) + 'pp'] })));
    h += deepAnalysis('Volume source: ' + (v.volume_source || 'run history + GSC') + '. Panel-free ≠ Profound 1.5B panel — label honestly.');
  }
  h += '</div>';
  return h;
}
function renderGraveyard(s) {
  const g = s.content_graveyard || {};
  let h = sectionHeader('graveyard', 'Content Graveyard — What Persists (Somantra Aug-2026)', '2.4M citations: 57.2% of domains cited once then never again. Comparison / FAQ / discount-savings persist ~2x. "Complete guide" vanishes ~3.5x. First 30% of page wins 44% of cites. Named author + bio +60% (Presenc, 1800 pairs). Live: GET /api/graveyard.', '🪦');
  if (g.status === 'projected_single_run') {
    h += insight('PROJECTED (1 run in trends.db): persistence from format priors, not measured. ' + (g.message || ''), 'warn');
    h += miniTable(['Format', 'Cites this run', 'Expected persistence', 'Guidance'], (g.formats || []).map((f) => ({ cells: [f.format, f.cites_this_run, '×' + f.expected_persistence, 'Ship comparison/FAQ; avoid "complete guide" framing'] })));
  } else if (g.status === 'measured') {
    h += `<div class="res-kpi-row"><div class="res-kpi"><div class="val">${g.one_and_done_pct}%</div><div class="lbl">One-and-Done (you vs 57.2% bench)</div></div><div class="res-kpi"><div class="val">${g.domains_tracked}</div><div class="lbl">Domains Tracked</div></div><div class="res-kpi"><div class="val">${g.runs_in_history}</div><div class="lbl">Runs in History</div></div></div>`;
    h += miniTable(['At-risk domain', 'Months cited'], (g.at_risk_domains || []).slice(0, 10).map(([d, m]) => ({ cells: [d, m] })));
  } else h += insight('No graveyard yet. ' + (g.message || 'Run 2+ daily cycles; trends.db builds citation_history.'), 'warn');
  h += businessImpact('What persists (Somantra 2026)', ['Comparison pages + FAQ + discount/savings language persist ~2x — ship those formats first.', '"Complete guide" framing is 3.5x more likely to vanish — split into task-complete pages.', 'Move the answer into the first 30% of the page (44% of citations). Named author + bio (+60%).']);
  h += '</div>';
  return h;
}
function renderThirdParty(s) {
  let h = sectionHeader('thirdparty', 'Third-Party Dominance — Earn / Edit / Respond', 'YouTube 0.737 correlation · Reddit 6.6% on Perplexity · Google-owned 22.8% on Gemini · Wikipedia 16.3% ChatGPT / 11.2% Gemini. Agencies sell this: top-10 missing_authority_nodes + owner + pitch draft + outreach_briefs/*.md. Live: GET /api/third-party.', '◉');
  const gs = s.graph_stats || {};
  const missing = gs.missing_authority_nodes || (s.third_party_geo || {}).missing_authority_nodes || [];
  if (!missing.length) h += insight('No missing-authority nodes yet — run a full analysis with citations. Earn/edit/respond scoring appears per citing URL.', 'warn');
  else h += miniTable(['Missing authority', 'Weight', 'Play'], missing.slice(0, 10).map((m) => ({ cells: [m.domain || m.url || JSON.stringify(m).slice(0, 60), m.weight || '—', m.play || 'earn/edit/respond → outreach_briefs/*.md'] })));
  h += deepAnalysis('Off-platform signals: track Reddit threads + YouTube chapters citing competitors. Edit (Wikipedia/Reddit with sources) vs Earn (pitch data) vs Respond (reviews/forum) — scored per URL in third_party_geo.py.');
  h += '</div>';
  return h;
}
function renderCommerceLocal(s) {
  const c = s.commerce || {};
  let h = sectionHeader('commerce', 'Multimodal + Merchant + Local — Revenue Surfaces', 'Image alt · VideoObject/transcripts/chapters (YouTube 0.737) · GTIN/price/availability feed · ACP checkout_eligibility probe · Shopify UCP native_commerce badge · Rufus (Amazon) · ChatGPT Shopping data · per-locale GBP checklist. Live: GET /api/commerce-local. Enterprise buyers REQUIRE this on page 1.', '🛒');
  h += insight('Run: <code>python scripts/multimodal_merchant_audit.py --site https://YOUR-SITE/ --feed merchant_feed.csv</code> + <code>node scripts/acp_probe.js --cron</code>. MCP/WebMCP tool-call e2e: <code>python scripts/mcp_tool_test.py &lt;site&gt;</code>.', '');
  if (c.status === 'ok' || c.feed_health) h += miniTable(['Check', 'Result'], Object.entries(c.feed_health || c).slice(0, 12).map(([k, v]) => ({ cells: [k, typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v)] })));
  else h += insight('No merchant audit yet. ' + (c.message || 'Upload a merchant feed or run the audit script.'), 'warn');
  h += '</div>';
  return h;
}
