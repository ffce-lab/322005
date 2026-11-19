"use strict";
/* ===== 经销商页：查询配件 → 加入购物车 → 生成《出口配件需求定单》xlsx ===== */

let META = {}, CATALOG = null, PRICES = {}, MODEL_OF = {}, RATES = normRates(null);
let CUR = "CNY";      /* 经销商当前选择的显示货币 */
let currentModel = "", currentCfg = "ALL", keyword = "", page = 1, curList = [];
let pageSize = PAGE_SIZES.includes(LS.get("yc_page_size", 50)) ? LS.get("yc_page_size", 50) : 50;
let scope = LS.get("yc_scope", "model") === "all" ? "all" : "model";   /* 搜索范围：model = 当前机型，all = 所有机型 */
let allMode = false;       /* 当前列表是否为「所有机型」搜索结果 */
let HAY = {};              /* 机型 → 每行的搜索文本（已转小写、去重音） */

/* 购物车：[{no, qty, cn, en, models:[], cfgs:[]}]，单价在显示 / 导出时按最新价格表取 */
let cart = LS.get("yc_cart_v2", []);
let buyer = LS.get("yc_buyer", {});
function saveCart(){ LS.set("yc_cart_v2", cart); renderBadge(); }

function getPrice(no){ return priceObj(PRICES[no]); }
function partsOf(model){ return (CATALOG.parts[model] || []).map(partObj); }
function cfgInfo(model, no){
  const c = (CATALOG.configs[model] || []).find(x=>x[0]===no);
  return c ? {no:c[0], cn:c[1]||"", en:c[2]||"", fr:c[3]||""} : {no:no, cn:"", en:"", fr:""};
}
function buildHay(){
  HAY = {};
  CATALOG.models.forEach(m=>{
    HAY[m.id] = (CATALOG.parts[m.id] || []).map(a=>fold([a[3], a[4], a[5], a[8], a[6], a[0]].join(" ")));
  });
}
/* 多个关键词用空格隔开时，需要同时命中（例如 "bolt m10"） */
function makeMatcher(){
  const toks = fold(keyword).split(/\s+/).filter(Boolean);
  return h => toks.every(t=>h.includes(t));
}
function computeList(){
  const ok = keyword ? makeMatcher() : null;
  allMode = !!keyword && scope === "all";
  const list = [];
  if(allMode){
    const seen = new Set();     /* 同图号只显示一次；当前机型的结果排在前面 */
    const order = [CATALOG.models.find(m=>m.id === currentModel), ...CATALOG.models.filter(m=>m.id !== currentModel)].filter(Boolean);
    order.forEach(m=>{
      const hay = HAY[m.id];
      (CATALOG.parts[m.id] || []).forEach((a,i)=>{
        if(seen.has(a[3]) || !ok(hay[i])) return;
        seen.add(a[3]);
        const p = partObj(a); p._m = m.id; list.push(p);
      });
    });
  } else {
    const hay = HAY[currentModel];
    (CATALOG.parts[currentModel] || []).forEach((a,i)=>{
      if(!keyword && currentCfg !== "ALL" && a[0] !== currentCfg) return;
      if(ok && !ok(hay[i])) return;
      list.push(partObj(a));
    });
  }
  return list;
}
/* 当前机型搜索时：其他机型里还有多少个命中（同图号只算一次） */
function otherModelHits(){
  if(!keyword || allMode) return null;
  const ok = makeMatcher(), seen = new Set(), per = [];
  (CATALOG.parts[currentModel] || []).forEach((a,i)=>{ if(ok(HAY[currentModel][i])) seen.add(a[3]); });
  CATALOG.models.forEach(m=>{
    if(m.id === currentModel) return;
    let n = 0;
    (CATALOG.parts[m.id] || []).forEach((a,i)=>{ if(seen.has(a[3]) || !ok(HAY[m.id][i])) return; seen.add(a[3]); n++; });
    if(n) per.push({id:m.id, n});
  });
  return {total: per.reduce((s,x)=>s + x.n, 0), per};
}
function renderScopeSel(){
  const sel = document.getElementById("scopeSel");
  sel.innerHTML = `<option value="model">${esc(t("scopeModel", {m:currentModel}))}</option><option value="all">${esc(t("scopeAll"))}</option>`;
  sel.value = scope;
}
function setScope(s){
  scope = s === "all" ? "all" : "model";
  LS.set("yc_scope", scope);
  document.getElementById("scopeSel").value = scope;
  page = 1; renderParts(); resetListScroll();
}
function findPart(no){
  for(const m of CATALOG.models){
    const a = (CATALOG.parts[m.id] || []).find(x=>x[3]===no);
    if(a) return partObj(a);
  }
  return null;
}
function priceHtml(pr){
  const d = displayPrice(pr);
  if(!d) return `<span class="price na">${esc(t("onRequest"))}</span>`;
  return `<span class="price"><span class="cur">${esc(curSym(d.cur))}</span>${money(d.price)}`
    + (d.converted ? `<span class="orig">${esc(t("origPrice", {p:curSym(d.origCur) + money(d.orig)}))}</span>` : "")
    + `</span><div class="spec">${esc(d.cur)}</div>`;
}
/* 按所选货币显示的单价：{price, cur, converted, orig, origCur}；无价格返回 null。
 * 原币与所选货币相同或缺少汇率时显示原币。 */
function displayPrice(pr){
  if(!pr || pr.price === "" || pr.price == null) return null;
  const orig = Number(pr.price), origCur = pr.currency || "CNY";
  if(origCur === CUR) return {price:orig, cur:CUR, converted:false, orig, origCur};
  const v = convertAmount(orig, origCur, CUR, RATES);
  return v == null ? {price:orig, cur:origCur, converted:false, orig, origCur}
                   : {price:v, cur:CUR, converted:true, orig, origCur};
}

/* ================= 货币 ================= */
function renderCurrency(){
  const sel = document.getElementById("curSel"), list = availCurrencies(RATES);
  sel.style.display = list.length > 1 ? "" : "none";
  sel.innerHTML = list.map(c=>`<option value="${c}" ${c===CUR?"selected":""}>${esc(curSym(c).trim())} ${c}</option>`).join("");
  const note = rateNoteText(false);
  ["rateNote", "cartRateNote"].forEach(id=>{
    const el = document.getElementById(id);
    el.style.display = note ? "" : "none";
    el.textContent = id === "rateNote" ? note : rateNoteText(true);
  });
}
function rateNoteText(short){
  if(CUR === "CNY" || !cnyPer(RATES, CUR)) return "";
  return t(short ? "rateNoteShort" : "rateNote", {cur:CUR, rate:fmtRate(cnyPer(RATES, CUR)), date:RATES.date || "—"});
}
function setCurrency(c){
  const list = availCurrencies(RATES);
  CUR = list.includes(c) ? c : (list.includes(RATES.default) ? RATES.default : "CNY");
  LS.set("yc_currency", CUR);
  renderCurrency();
  if(!CATALOG) return;
  renderParts();
  if(document.getElementById("cartDrawer").classList.contains("show")) renderCart();
}

/* ================= 机型 / 分类 ================= */
function renderTabs(){
  document.getElementById("modelTabs").innerHTML = CATALOG.models.map(m=>
    `<button class="model-tab ${m.id===currentModel?"active":""}" data-model="${esc(m.id)}">${esc(m.id)}</button>`).join("");
}
function switchModel(id){
  if(!CATALOG.parts[id]) return;
  currentModel = id; currentCfg = "ALL"; keyword = ""; page = 1;
  document.getElementById("searchIn").value = ""; renderScopeSel();
  LS.set("yc_last_model", id);
  renderTabs(); renderCfgs(); renderParts();
  resetListScroll(); window.scrollTo({top:0, behavior:"smooth"});
}
function renderCfgs(){
  const m = CATALOG.models.find(x=>x.id===currentModel);
  const list = CATALOG.parts[currentModel] || [];
  const counts = {}; list.forEach(a=>counts[a[0]] = (counts[a[0]]||0) + 1);
  document.getElementById("cfgList").innerHTML =
    `<div class="cfg-item ${currentCfg==="ALL"?"active":""}" data-cfg="ALL">
       <span class="cn">${esc(t("allParts"))}</span>
       <span class="meta"><span>${esc(t("itemsN", {n:list.length}))}</span></span></div>`
    + (CATALOG.configs[currentModel] || []).map(c=>`
      <div class="cfg-item ${currentCfg===c[0]?"active":""} ${counts[c[0]]?"":"zero"}" data-cfg="${esc(c[0])}">
        <span class="cn">${esc(nameMain(c[1], c[2], c[3]) || "—")} <small>${esc(nameSub(c[1], c[2]))}</small></span>
        <span class="meta"><span class="no">${esc(c[0])}</span><span>${esc(t("catN", {n:counts[c[0]]||0}))}</span></span>
      </div>`).join("");
  document.getElementById("modelName").textContent = modelTitle(m);
  document.getElementById("modelEn").textContent = (LANG === "zh" ? m.id + " " + m.en + " · " : "") + t("partsBook");
  document.getElementById("statParts").textContent = t("partsCount", {n:list.length});
}

/* ================= 配件明细 ================= */
function renderParts(){
  const list = computeList();
  curList = list;
  /* 单车用量只在选中某个分类时显示（全部配件、搜索结果里不显示） */
  document.getElementById("partTable").classList.toggle("hide-qty", currentCfg === "ALL" || !!keyword);
  const pages = pageCount(list.length, pageSize);
  if(page > pages) page = pages;
  const start = (page-1)*pageSize;
  const view = list.slice(start, start+pageSize);

  const cfgHead = document.getElementById("cfgHead");
  const clearBtn = keyword ? `<button class="btn btn-ghost btn-sm" data-clear>${esc(t("searchClear"))}</button>` : "";
  if(keyword){
    cfgHead.innerHTML = `<span>${esc(t("searchFor"))}</span><b>${esc(keyword)}</b><span>${esc(t("searchIn", {s:allMode ? t("scopeAllName") : currentModel}))}</span>${clearBtn}`;
  } else if(currentCfg === "ALL"){
    cfgHead.innerHTML = `<span>${esc(t("scope"))}</span><b>${esc(t("allParts"))}</b><span>${esc(t("clickCat"))}</span>`;
  } else {
    const c = cfgInfo(currentModel, currentCfg);
    cfgHead.innerHTML = `<span>${esc(t("curCat"))}</span><b>${esc(nameMain(c.cn, c.en, c.fr) || "—")} ${esc(nameSub(c.cn, c.en))}</b><span class="no">${esc(currentCfg)}</span>`;
  }
  renderSearchNote(list);

  const body = document.getElementById("partBody");
  if(!view.length){
    const msg = t(currentCfg!=="ALL" && !keyword ? "emptyCat" : "noMatch");
    body.innerHTML = `<tr class="empty-row"><td colspan="9">${esc(msg)}</td></tr>`;
  } else {
    const inCart = {}; cart.forEach(c=>inCart[c.no] = c.qty);
    body.innerHTML = view.map((p,idx)=>{
      const i = start + idx;
      const ms = MODEL_OF[p.no] || [p._m || currentModel];
      const multi = ms.length > 1;
      const q = inCart[p.no];
      return `<tr class="${q?"in-cart":""}">
        <td>${esc(p.seq)}</td>
        <td class="partno">${esc(p.no)}</td>
        <td>
          <div class="desc-cn">${esc(nameMain(p.cn, p.en, p.fr) || "—")}</div>
          <div class="desc-en">${esc(nameSub(p.cn, p.en))}</div>
          <span class="cfg-badge">${esc(p.cfg)}</span>
        </td>
        <td><div class="spec">${esc(p.spec || "—")}</div>${p.rm?`<div class="rmk">${esc(p.rm)}</div>`:""}</td>
        <td class="col-qty" style="text-align:center;font-weight:600">${esc(p.qty)}</td>
        <td>${ms.map(x=>`<span class="tag ${multi?"multi":""}">${esc(x)}</span>`).join("")}${multi?`<div class="spec">${esc(t("common"))}</div>`:""}</td>
        <td>${priceHtml(getPrice(p.no))}</td>
        <td><input class="qty-in" type="number" min="1" step="1" id="q_${i}" value="1"></td>
        <td><button class="btn btn-add btn-sm" data-add="${i}">${esc(t("add"))}</button>
          ${q?`<div class="spec" style="color:var(--ok);margin-top:4px">${esc(t("inCart", {n:q}))}</div>`:""}</td>
      </tr>`;
    }).join("");
  }
  document.getElementById("pager").innerHTML = pagerHtml(list.length, page, pageSize, {
    total: n => t("pgTotal", {n}) + (keyword ? t("pgFiltered") : ""),
    prev: t("pgPrev"), next: t("pgNext"), goto: t("pgGoto"), of: n => t("pgOf", {n}), perPage: t("pgPerPage")
  });
  buildStickyHead();
}

/* 搜索提示：当前机型搜索时告诉客户其他机型里还有多少命中，并可一键改搜所有机型 */
function renderSearchNote(list){
  const el = document.getElementById("searchNote");
  el.className = "search-note";
  if(allMode){
    el.className += " info";
    el.innerHTML = `<span>${esc(t("allHit", {n:list.length}))}</span><span class="spacer"></span>`
      + `<button class="btn btn-ghost btn-sm" data-scope="model">${esc(t("btnBackModel", {m:currentModel}))}</button>`;
    el.style.display = ""; return;
  }
  const h = otherModelHits();
  if(!h || !h.total){ el.style.display = "none"; return; }
  const lst = h.per.slice(0, 8).map(x=>`${x.id} (${x.n})`).join(", ") + (h.per.length > 8 ? " …" : "");
  const msg = list.length ? t("otherHit", {n:h.total, list:lst}) : t("otherHitNone", {m:currentModel, n:h.total, list:lst});
  el.innerHTML = `<span>${esc(msg)}</span><span class="spacer"></span>`
    + `<button class="btn btn-add btn-sm" data-scope="all">${esc(t("btnSearchAll"))}</button>`;
  el.style.display = "";
}

/* ================= 购物车 ================= */
function addToCart(i){
  const p = curList[i]; if(!p) return;
  const q = parseInt(document.getElementById("q_"+i).value, 10);
  if(!(q > 0)){ toast(t("badQty"), "err"); return; }
  const ms = allMode ? (MODEL_OF[p.no] || [p._m]) : [currentModel];     /* 所有机型搜索时记录该配件适用的全部机型 */
  let line = cart.find(c=>c.no===p.no);
  if(line){
    line.qty += q;
    ms.forEach(m=>{ if(!line.models.includes(m)) line.models.push(m); });
    if(!line.cfgs.includes(p.cfg)) line.cfgs.push(p.cfg);
    if(p.fr && !line.fr) line.fr = p.fr;
  } else {
    cart.push({no:p.no, qty:q, cn:p.cn, en:p.en, fr:p.fr || "", models:ms.slice(), cfgs:[p.cfg]});
  }
  saveCart(); renderParts();
  const btn = document.getElementById("cartBtn");
  btn.classList.remove("bump"); void btn.offsetWidth; btn.classList.add("bump");
  toast(t("added", {no:p.no, q}), "ok");
}
function renderBadge(){
  const n = cart.length, b = document.getElementById("cartBadge");
  b.textContent = n; b.classList.toggle("zero", !n);
}
function cartTotals(){
  const sums = {}; let unpriced = 0;
  cart.forEach(c=>{
    const d = displayPrice(getPrice(c.no));
    if(d) sums[d.cur] = Math.round(((sums[d.cur]||0) + d.price*c.qty) * 100) / 100;
    else unpriced++;
  });
  return {sums, unpriced};
}
function renderCart(){
  document.getElementById("cartCount").textContent = t("selected", {n:cart.length});
  const box = document.getElementById("cartList");
  if(!cart.length){
    box.innerHTML = `<div class="hint">${esc(t("cartEmpty"))}</div>`;
  } else {
    box.innerHTML = `<table class="cart-tbl"><thead><tr>
        <th>#</th><th>${esc(t("cPartNo"))}</th><th>${esc(t("cDesc"))}</th><th>${esc(t("cModel"))}</th>
        <th>${esc(t("cPrice"))}</th><th>${esc(t("cQty"))}</th><th>${esc(t("cSubtotal"))}</th><th></th></tr></thead><tbody>`
      + cart.map((c,i)=>{
          const d = displayPrice(getPrice(c.no));
          const gone = !findPart(c.no);
          return `<tr>
            <td>${i+1}</td>
            <td class="partno">${esc(c.no)}${gone?`<div><span class="tag err">${esc(t("discontinued"))}</span></div>`:""}</td>
            <td><div class="desc-cn">${esc(nameMain(c.cn, c.en, c.fr))}</div><div class="desc-en">${esc(nameSub(c.cn, c.en))}</div></td>
            <td>${c.models.map(m=>`<span class="tag">${esc(m)}</span>`).join("")}</td>
            <td>${d ? esc(curSym(d.cur)) + money(d.price) : `<span class="price na">${esc(t("onRequest"))}</span>`}</td>
            <td><input class="qty-in" type="number" min="1" step="1" value="${c.qty}" data-cartqty="${i}"></td>
            <td style="font-weight:700">${d ? esc(curSym(d.cur)) + money(d.price*c.qty) : "—"}</td>
            <td><button class="btn btn-del btn-sm" data-cartdel="${i}">${esc(t("remove"))}</button></td>
          </tr>`;
        }).join("") + "</tbody></table>";
  }
  const tt = cartTotals();
  const parts = Object.entries(tt.sums).map(([c,v])=>esc(curSym(c)) + money(v));
  document.getElementById("cartTotal").innerHTML = (parts.join(" ＋ ") || "0.00")
    + (tt.unpriced ? `<span class="spec" style="font-weight:400">${esc(t("onReqN", {n:tt.unpriced}))}</span>` : "");
}
function openCart(){
  renderCart();
  document.getElementById("cartMask").classList.add("show");
  document.getElementById("cartDrawer").classList.add("show");
}
function closeCart(){
  document.getElementById("cartMask").classList.remove("show");
  document.getElementById("cartDrawer").classList.remove("show");
  renderParts();
}
function clearCart(){
  if(!cart.length) return;
  if(!confirm(t("confirmClear"))) return;
  cart = []; saveCart(); renderCart();
}

/* 订单信息（经销商填写部分） */
const BUYER_REQ = {cust:"fCust", contact:"fContact", tel:"fTel"};
function renderTransOptions(){
  const sel = document.getElementById("bTrans");
  sel.innerHTML = `<option value="">${esc(t("fSelect"))}</option>`
    + TRANSPORT_OPTS.map(o=>`<option value="${esc(o.v)}">${esc(t(o.k))}</option>`).join("");
  sel.value = TRANSPORT_OPTS.some(o=>o.v === buyer.trans) ? buyer.trans : "";
}
/* 订单号 = 客户名称 + 当前日期（例如 Test Trading Co., Ltd.-20261103） */
function makeOrderNo(){
  const name = safeName(String(buyer.cust || "").replace(/\s+/g, " ")).slice(0, 40).trim();
  return name ? name + "-" + todayStr().replace(/-/g, "") : "";
}
function updateOrderNo(){ document.getElementById("bOrderNo").value = makeOrderNo(); }
function initBuyer(){
  renderTransOptions();
  document.querySelectorAll("[data-k]").forEach(el=>{
    el.value = buyer[el.dataset.k] || "";
    el.addEventListener("input", ()=>{ buyer[el.dataset.k] = el.value; el.classList.remove("bad"); LS.set("yc_buyer", buyer); updateOrderNo(); });
    el.addEventListener("change", ()=>{ buyer[el.dataset.k] = el.value; LS.set("yc_buyer", buyer); updateOrderNo(); });
  });
  updateOrderNo();
}

/* ================= 生成订单 xlsx（版式与《出口配件需求定单》模板一致） ================= */
function safeName(s){ return String(s||"").replace(/[\\\/:*?"<>|\r\n]+/g, "_").trim().slice(0, 60); }

function exportOrder(){
  if(!cart.length){ toast(t("cartIsEmpty"), "err"); return; }
  const miss = [];
  Object.keys(BUYER_REQ).forEach(k=>{
    const el = document.querySelector(`[data-k="${k}"]`);
    if(!String(buyer[k]||"").trim()){ miss.push(t(BUYER_REQ[k])); el.classList.add("bad"); }
  });
  if(miss.length){ toast(t("fillReq", {list:miss.join("\n")}), "err"); return; }

  const S = XLSX_LITE.S, V = (v,s,f)=>({v:v, s:s, f:f});
  const issue = todayStr(), orderNo = makeOrderNo();
  const lines = cart.map(c=>{
    const p = findPart(c.no), pr = getPrice(c.no), d = displayPrice(pr);
    return {no:c.no, qty:c.qty, cn:(p&&p.cn)||c.cn, en:(p&&p.en)||c.en, models:c.models, cfgs:c.cfgs,
            code:(pr&&pr.code)||"", price:d?d.price:null, cur:d?d.cur:"",
            orig:d?d.orig:null, origCur:d?d.origCur:"", converted:!!(d&&d.converted)};
  });
  const curs = [...new Set(lines.filter(l=>l.cur).map(l=>l.cur))];
  const curHead = curs.length === 1 ? curs[0] : (curs.length ? "见备注 see remark" : CUR);
  const anyConv = lines.some(l=>l.converted);
  const rateTxt = anyConv ? `1 ${CUR} = ${fmtRate(cnyPer(RATES, CUR))} CNY（${RATES.date || "—"}）` : "";

  /* —— Sheet 1：出口配件需求定单（11 列 A–K，表头位置与模板一致，明细从第 7 行开始） —— */
  const rows = [], mg = ["A1:K1","D2:F2","D3:F3","D4:F4","G2:I2","G3:I3","G4:I4","A5:A6","B5:C5","D5:E5","I6:J6"];
  const blank = s => V("", s);
  rows.push([V("出  口  配  件  需  求  定  单    EXPORT PARTS REQUIREMENT ORDER", S.TITLE), ...Array(10).fill(blank(S.TITLE))]);
  rows.push([V("定单编号：*",S.LABEL), V(orderNo,S.LEFT), V("客户名称(售达方/送达方)：*",S.LABEL), V(buyer.cust,S.VALUE), blank(S.VALUE), blank(S.VALUE),
             V("联系人 Contact：" + (buyer.contact||""),S.VALUE), blank(S.VALUE), blank(S.VALUE), V("付款方式：*",S.LABEL), blank(S.VALUE)]);
  rows.push([V("编 制 人：*",S.LABEL), blank(S.VALUE), V("收票方/付款方：",S.LABEL), V(buyer.payer||"",S.VALUE), blank(S.VALUE), blank(S.VALUE),
             V("联系方式 Tel：" + (buyer.tel||""),S.VALUE), blank(S.VALUE), blank(S.VALUE), V("运输/包装方式：*",S.LABEL), V(buyer.trans||"",S.VALUE)]);
  rows.push([V("编制日期：",S.LABEL), V(issue,S.VALUE), V("交货日期：*",S.LABEL), V(buyer.deliv||"",S.VALUE), blank(S.VALUE), blank(S.VALUE),
             V(anyConv ? "参考汇率 Rate：" + rateTxt : "下单时间 Created：" + nowStr(),S.VALUE), blank(S.VALUE), blank(S.VALUE), V("报关方式：*",S.LABEL), blank(S.VALUE)]);
  rows.push(["序号","配件名称*","","图     号*","","","物料号","数量*","单价","金额","备注"].map(t=>V(t,S.HEAD)));
  rows.push(["","英文","中文","销售业务员预核","工程师审核","名称","工程师审核","（件）","EXW（"+curHead+"）","","适用机型"].map(t=>V(t,S.SUBHEAD)));

  const first = rows.length + 1;
  lines.forEach((l,i)=>{
    const r = rows.length + 1;
    let rmk = l.models.join("/");
    if(curs.length > 1 && l.cur) rmk += " · " + l.cur;
    if(l.price == null) rmk += " · 待报价 To be quoted";
    rows.push([V(i+1,S.CTR), V(l.en,S.LEFT), V(l.cn,S.LEFT), V(l.no,S.CTR), blank(S.CTR), blank(S.CTR),
               V(l.code,S.CTR), V(l.qty,S.CTR), V(l.price==null?"":l.price,S.MONEY),
               l.price==null ? blank(S.MONEY) : V(Number((l.price*l.qty).toFixed(2)),S.MONEY,`H${r}*I${r}`),
               V(rmk,S.LEFT)]);
  });
  const last = rows.length;
  const tt = cartTotals(), totQty = lines.reduce((s,l)=>s+l.qty,0);
  const totAmt = curs.length === 1 ? Number((tt.sums[curs[0]]||0).toFixed(2)) : "";
  const rt = rows.length + 1;
  rows.push([V("合计 Total",S.TOTAL), ...Array(6).fill(blank(S.TOTAL)), V(totQty,S.TOTAL,`SUM(H${first}:H${last})`), blank(S.TOTAL),
             curs.length === 1 ? V(totAmt,S.MONEY_B,`SUM(J${first}:J${last})`) : blank(S.MONEY_B),
             V(curs.length > 1 ? Object.entries(tt.sums).map(([c,v])=>c+" "+money(v)).join("；") : "", S.LEFT)]);
  mg.push(`A${rt}:G${rt}`);
  if(buyer.remark){
    rows.push([V("客户备注 Customer Remark：" + buyer.remark, S.LEFT), ...Array(10).fill(blank(S.LEFT))]);
    mg.push(`A${rows.length}:K${rows.length}`);
  }
  rows.push([]);
  [
    ["填写说明 Instructions：", S.NOTE_B],
    ["1. 本定单由「海外经销商配件下单查询系统」生成。定单编号为系统自动生成（客户名称 + 日期）；编制人、付款方式、报关方式及审核栏由我司业务人员填写。", S.NOTE],
    ["   This order was generated by the Overseas Parts Ordering System. The order no. is generated automatically (customer name + date); prepared-by, payment term, customs and review columns are filled in by our staff.", S.NOTE],
    ["2. 单价为下单时系统价格，最终以我司确认为准；「待报价」配件由我司另行报价。", S.NOTE],
    ["   Prices are system prices at the time of ordering and subject to our confirmation. Items marked \"To be quoted\" will be quoted separately.", S.NOTE],
    ...(anyConv ? [
      ["3. 单价由人民币价格按参考汇率 " + rateTxt + " 换算，不是实时汇率；原人民币价格见「明细数据」工作表。", S.NOTE],
      ["   Prices were converted from CNY at the reference rate above. This is NOT a real-time exchange rate; original CNY prices are listed in the \"Data\" sheet.", S.NOTE]
    ] : [])
  ].forEach(([txt,s])=>{ rows.push([V(txt,s)]); mg.push(`A${rows.length}:K${rows.length}`); });

  const heights = {1:30}; for(let r=2; r<=6; r++) heights[r] = 18; heights[2] = 32;

  /* —— Sheet 2：明细数据（一行一个配件，便于多份定单汇总统计） —— */
  const DH = ["订单号","客户名称","联系人","联系方式","编制日期","期望交货日期","运输方式","序号","图号","物料号","配件名称(中文)","配件名称(英文)","数量","单价","币种","金额","适用机型","配置号","客户备注","原币单价","原币种","参考汇率(1外币=?CNY)","汇率日期"];
  const drows = [DH.map(h=>V(h,S.DHEAD))];
  lines.forEach((l,i)=>{
    const r = drows.length + 1;
    drows.push([orderNo, buyer.cust, buyer.contact||"", buyer.tel||"", issue, buyer.deliv||"", buyer.trans||"", i+1, l.no, l.code, l.cn, l.en, l.qty,
                l.price==null?"":l.price, l.cur, l.price==null?"":V(Number((l.price*l.qty).toFixed(2)),0,`M${r}*N${r}`),
                l.models.join("/"), l.cfgs.join("/"), buyer.remark||"",
                l.orig==null?"":l.orig, l.origCur, l.converted ? cnyPer(RATES, l.cur) : "", l.converted ? (RATES.date||"") : ""]);
  });

  const blob = XLSX_LITE.write([
    {name:"出口配件需求定单", rows, merges:mg, heights, widths:[11.5,21.3,29.6,23,17.1,15.8,12,12.4,11.4,15.7,25.8]},
    {name:"明细数据 Data", rows:drows, freeze:1, autoFilter:`A1:W${drows.length}`,
     widths:[30,24,12,18,12,14,12,6,22,12,22,26,8,10,7,12,16,18,24,10,8,14,12]}
  ]);
  const fname = orderNo + "_出口配件需求定单.xlsx";      /* 订单号已包含客户名称和日期 */
  saveFile(blob, fname, {saved:t("saved"), downloaded:t("downloaded")}).then(ok=>{
    if(!ok) return;
    document.getElementById("doneFile").textContent = t("fileName", {f:fname});
    document.getElementById("doneMask").classList.add("show");
  });
}
function closeDone(clear){
  document.getElementById("doneMask").classList.remove("show");
  if(clear){ cart = []; saveCart(); renderCart(); }
}

/* ================= 事件 ================= */
document.getElementById("modelTabs").addEventListener("click", e=>{
  const b = e.target.closest("[data-model]"); if(b) switchModel(b.dataset.model);
});
document.getElementById("cfgList").addEventListener("click", e=>{
  const c = e.target.closest("[data-cfg]"); if(!c) return;
  currentCfg = c.dataset.cfg; page = 1;
  keyword = ""; document.getElementById("searchIn").value = "";      /* 点分类 = 按分类浏览，清除搜索 */
  renderCfgs(); renderParts(); resetListScroll(document.getElementById("partsCard"), true);
});
document.getElementById("scopeSel").addEventListener("change", e=>setScope(e.target.value));
document.getElementById("searchNote").addEventListener("click", e=>{
  const b = e.target.closest("[data-scope]"); if(b) setScope(b.dataset.scope);
});
document.getElementById("cfgHead").addEventListener("click", e=>{
  if(!e.target.closest("[data-clear]")) return;
  keyword = ""; document.getElementById("searchIn").value = ""; page = 1; renderParts(); resetListScroll();
});
document.getElementById("partBody").addEventListener("click", e=>{
  const b = e.target.closest("[data-add]"); if(b) addToCart(+b.dataset.add);
});
document.getElementById("partBody").addEventListener("keydown", e=>{
  if(e.key === "Enter" && e.target.id && e.target.id.startsWith("q_")) addToCart(+e.target.id.slice(2));
});
bindPager(document.getElementById("pager"), () => pageCount(curList.length, pageSize),
  p => { page = p; renderParts(); resetListScroll(document.getElementById("partsCard"), true); },
  s => { page = Math.floor((page-1) * pageSize / s) + 1; pageSize = s; LS.set("yc_page_size", s); renderParts(); resetListScroll(document.getElementById("partsCard"), true); });

/* ================= 语言 ================= */
function setLang(l){
  if(!I18N[l]) return;
  LANG = l; LS.set("yc_lang", l);
  document.getElementById("langSel").value = l;
  applyI18n();
  if(!CATALOG) return;
  document.getElementById("statUpdated").textContent = t("updated", {d:META.updatedAt || "—"});
  renderTransOptions(); renderCurrency(); renderScopeSel(); renderCfgs(); renderParts();
  if(document.getElementById("cartDrawer").classList.contains("show")) renderCart();
}
document.getElementById("langSel").addEventListener("change", e=>setLang(e.target.value));
document.getElementById("curSel").addEventListener("change", e=>setCurrency(e.target.value));
document.getElementById("cartList").addEventListener("change", e=>{
  const i = e.target.dataset.cartqty; if(i == null) return;
  const q = parseInt(e.target.value, 10);
  if(q > 0) cart[+i].qty = q; else e.target.value = cart[+i].qty;
  saveCart(); renderCart();
});
document.getElementById("cartList").addEventListener("click", e=>{
  const b = e.target.closest("[data-cartdel]"); if(!b) return;
  cart.splice(+b.dataset.cartdel, 1); saveCart(); renderCart();
});
let searchTimer = null;
document.getElementById("searchIn").addEventListener("input", e=>{
  clearTimeout(searchTimer);
  const v = e.target.value.trim();
  searchTimer = setTimeout(()=>{ keyword = v; page = 1; renderParts(); resetListScroll(); }, 180);
});
document.addEventListener("keydown", e=>{ if(e.key === "Escape"){ closeCart(); closeDone(false); } });

/* ================= 表头吸顶 ================= */
const stickyHead = document.getElementById("stickyHead");
const stickyTable = document.getElementById("stickyTable");
const stickyThead = document.getElementById("stickyThead");
const listScrollEl = document.getElementById("listScroll");

/* 克隆一份表头并同步列宽：表格本体在横向滚动容器里，普通 sticky 无法相对页面固定 */
function buildStickyHead(){
  const srcTable = document.getElementById("partTable");
  const srcHead = srcTable && srcTable.tHead;
  if(!stickyHead || !stickyThead || !srcHead) return;
  stickyThead.innerHTML = srcHead.innerHTML;
  stickyTable.className = srcTable.className;
  const widths = Array.from(srcHead.rows[0].cells).map(th => th.getBoundingClientRect().width);
  const sum = widths.reduce((a,b)=>a+b, 0);
  const total = Math.max(srcTable.getBoundingClientRect().width, sum);
  Array.from(stickyThead.rows[0].cells).forEach((th,i)=>{
    th.style.width = (sum ? widths[i] * total / sum : 0) + "px";
  });
  stickyTable.style.width = total + "px";
  positionStickyHead();
}

function positionStickyHead(){
  if(!stickyHead) return;
  const srcTable = document.getElementById("partTable");
  const srcHead = srcTable && srcTable.tHead;
  const cfg = document.getElementById("cfgHead");
  if(!srcHead || !cfg || !listScrollEl){ stickyHead.classList.remove("show"); return; }
  const topbar = document.querySelector(".topbar");
  const top = (topbar ? topbar.offsetHeight : 58) + cfg.offsetHeight;
  const headRect = srcHead.getBoundingClientRect();
  const tableRect = srcTable.getBoundingClientRect();
  if(headRect.top < top && tableRect.bottom > top + headRect.height){
    const wr = listScrollEl.getBoundingClientRect();
    stickyHead.style.left = wr.left + "px";
    stickyHead.style.width = wr.width + "px";
    stickyHead.style.top = top + "px";
    stickyHead.classList.add("show");
    stickyHead.scrollLeft = listScrollEl.scrollLeft;
  } else {
    stickyHead.classList.remove("show");
  }
}

let stickyRaf = 0;
function onStickyScroll(){
  if(stickyRaf) return;
  stickyRaf = requestAnimationFrame(()=>{ stickyRaf = 0; positionStickyHead(); });
}
window.addEventListener("scroll", onStickyScroll, {passive:true});
window.addEventListener("resize", buildStickyHead);
if(listScrollEl) listScrollEl.addEventListener("scroll", ()=>{
  if(stickyHead) stickyHead.scrollLeft = listScrollEl.scrollLeft;
}, {passive:true});

/* 回到顶部：整页滚动超过一屏后出现 */
const toTopBtn = document.getElementById("toTop");
function updateToTop(){ if(toTopBtn) toTopBtn.classList.toggle("show", window.scrollY > 400); }
window.addEventListener("scroll", updateToTop, {passive:true});
if(toTopBtn){
  toTopBtn.addEventListener("click", ()=>window.scrollTo({top:0, behavior:"smooth"}));
  updateToTop();
}
/* 其他标签页修改了购物车时同步 */
window.addEventListener("storage", e=>{
  if(e.key === "yc_cart_v2"){ cart = LS.get("yc_cart_v2", []); renderBadge(); }
});

/* ================= 初始化 ================= */
(async function init(){
  document.getElementById("langSel").innerHTML = LANGS.map(l=>`<option value="${l.id}">${esc(l.label)}</option>`).join("");
  setLang(detectLang());
  renderBadge();
  try{
    const d = await loadData();
    META = d.meta; CATALOG = d.catalog; PRICES = d.prices; RATES = d.rates;
  }catch(err){
    document.getElementById("loading").outerHTML = loadErrorHtml(err);
    return;
  }
  MODEL_OF = buildModelsOf(CATALOG);
  buildHay();
  setCurrency(LS.get("yc_currency", "") || RATES.default);
  const last = LS.get("yc_last_model", "");
  currentModel = CATALOG.parts[last] ? last : CATALOG.models[0].id;
  document.getElementById("statUpdated").textContent = t("updated", {d:META.updatedAt || "—"});
  document.getElementById("loading").remove();
  document.getElementById("app").style.display = "";
  initBuyer();
  renderTabs(); renderScopeSel(); renderCfgs(); renderParts();
})();
