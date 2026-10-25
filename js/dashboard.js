'use strict';
// MỘC CAFÉ dashboard | Client UI with Supabase Auth, PostgREST, RPC and Realtime.
const sb = window.cafeSupabase;
const $ = id => document.getElementById(id);
const price = n => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(n) || 0);
const num = n => new Intl.NumberFormat('vi-VN').format(Number(n) || 0);
const fmtDate = d => new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const h = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeUrl = s => { const val=String(s||''); if(/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(val)) return val; try { const u = new URL(val); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const categoryLabels = { coffee:'Cà phê', tea:'Trà', juice:'Nước ép', cake:'Bánh ngọt', other:'Khác' };
const icons = { coffee:'☕', tea:'🍵', juice:'🍊', cake:'🍰', other:'🥤' };
const statusLabels = { new:'Mới tạo', preparing:'Đang pha chế', done:'Hoàn tất', cancelled:'Đã hủy' };
const paymentLabels = { paid:'Đã thanh toán', unpaid:'Chưa thanh toán' };
const titles = { overview:'Tổng quan hoạt động', orders:'Quản lý đơn hàng', cart:'Giỏ hàng', products:'Menu & sản phẩm', customers:'Khách hàng', reports:'Báo cáo kinh doanh' };
let user = null;
let demo = !sb;
let products = [], customers = [], orders = [];
let currentView = 'overview';
let channel = null;
let refreshTimer = null;
let refreshBusy = false;
let refreshAgain = false;
let cart = [];
let toastTimer = null;
let previewNoticeCooldown = false;
const DEMO_STATE_KEY = 'moc_cafe_demo_state_v2';
const CART_STORAGE_PREFIX = 'moc_cafe_cart_v2_';

const toast = (message, type='normal') => {
  const area = $('toastArea');
  area.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  area.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
};
const assertLive = (opts = {}) => {
  if (!demo && sb && user) return true;
  if (!opts.silent && !previewNoticeCooldown) {
    previewNoticeCooldown = true;
    toast('Đây là bản xem trước. Dữ liệu chỉ hiển thị tạm trên giao diện, chưa lưu thật lên Supabase.', 'error');
    setTimeout(() => { previewNoticeCooldown = false; }, 2500);
  }
  return false;
};
const dateKey = date => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const daysAgo = n => { let d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
const id = prefix => `${prefix}${Math.random().toString(36).slice(2,9)}`;

function createPreviewOrder({ customerId, paymentMethod, note }) {
  const now = new Date().toISOString();
  const customer = customers.find(c => c.id === customerId) || null;
  const orderItems = cart.map((item, idx) => {
    const product = products.find(p => p.id === item.product_id);
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(product?.price) || 0;
    return {
      id: `preview-item-${Date.now()}-${idx}`,
      product_name: product?.name || 'Sản phẩm',
      quantity,
      unit_price: unitPrice,
      line_total: unitPrice * quantity
    };
  });
  const total = orderItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const previewOrder = {
    id: `preview-order-${Date.now()}`,
    order_code: `MC-DEMO-${String(orders.length + 1).padStart(4, '0')}`,
    customer_id: customerId || null,
    customers: customer ? { name: customer.name } : { name: 'Khách lẻ' },
    created_at: now,
    status: 'new',
    payment_status: 'unpaid',
    payment_method: paymentMethod || 'cash',
    total,
    paid_at: null,
    note: note || '',
    order_items: orderItems
  };
  orders.unshift(previewOrder);
  persistDemoState();
  return previewOrder;
}

function savePreviewProduct(item, payload) {
  const imageUrl = payload.image_url ?? (item?.image_url || null);
  if (item) {
    Object.assign(item, {
      name: payload.name,
      category: payload.category,
      price: payload.price,
      description: payload.description,
      available: payload.available,
      image_url: imageUrl
    });
    persistDemoState();
    return item;
  }
  const product = {
    id: `preview-product-${Date.now()}`,
    name: payload.name,
    category: payload.category,
    price: payload.price,
    description: payload.description,
    available: payload.available,
    image_url: imageUrl,
    created_at: new Date().toISOString()
  };
  products.unshift(product);
  persistDemoState();
  return product;
}

function savePreviewCustomer(item, payload) {
  if (item) {
    Object.assign(item, payload);
    persistDemoState();
    return item;
  }
  const customer = {
    id: `preview-customer-${Date.now()}`,
    ...payload,
    created_at: new Date().toISOString()
  };
  customers.unshift(customer);
  persistDemoState();
  return customer;
}

const cartKey = () => CART_STORAGE_PREFIX + (user?.id || 'demo');
function persistCart(){
  try { localStorage.setItem(cartKey(),JSON.stringify(cart)); } catch(e) { console.warn('Không lưu được giỏ hàng cục bộ.',e); }
}
function restoreCart(){
  try {
    const saved=JSON.parse(localStorage.getItem(cartKey())||'[]');
    cart=Array.isArray(saved)?saved.filter(c=>c && typeof c.product_id==='string' && Number.isInteger(c.quantity) && c.quantity>=1 && c.quantity<=999 && products.some(p=>p.id===c.product_id && p.available)).slice(0,60):[];
  }catch(e){cart=[];}
  persistCart();
}
function persistDemoState(){
  if(!demo)return;
  try { localStorage.setItem(DEMO_STATE_KEY,JSON.stringify({v:2,products,customers,orders})); }
  catch(e){ console.warn('Bộ nhớ xem trước đã đầy. Giảm kích thước ảnh sản phẩm.',e); toast('Không đủ dung lượng lưu bản xem trước trong trình duyệt.','error'); }
}
function addCartItem(productId){
  const product=products.find(p=>p.id===productId);
  if(!product || !product.available){ toast('Món này đang ngừng bán hoặc không còn tồn tại.','error'); return; }
  let existing=cart.find(c=>c.product_id===productId);
  if(existing){if(existing.quantity>=999){toast('Mỗi món không được vượt quá 999.','error');return;} existing.quantity+=1;}
  else{if(cart.length>=60){toast('Giỏ hàng không thể vượt quá 60 loại món.','error');return;} cart.push({product_id:productId,quantity:1});}
  persistCart();renderCartPage();renderCart();toast(`Đã thêm ${product.name} vào giỏ.`, 'success');
}
function updateCartQuantity(productId, delta){
  const item=cart.find(c=>c.product_id===productId);if(!item)return;
  item.quantity=Math.min(999,item.quantity+delta);
  if(item.quantity<=0)cart=cart.filter(c=>c.product_id!==productId);
  persistCart();renderCart();renderCartPage();
}
function renderCartPage(){
  const lines=cart.map(c=>({...c,product:products.find(p=>p.id===c.product_id)}));
  const valid=lines.filter(c=>c.product && c.product.available);
  const stale=lines.length-valid.length;
  if(stale){cart=valid.map(c=>({product_id:c.product_id,quantity:c.quantity}));persistCart();}
  const itemCount=cart.reduce((sum,c)=>sum+c.quantity,0);
  const total=valid.reduce((sum,c)=>sum+Number(c.product.price)*c.quantity,0);
  $('navCartCount').textContent=num(itemCount);
  $('productCartCount').textContent=`(${num(itemCount)})`;
  $('cartItemSummary').textContent=`${num(itemCount)} món · ${num(cart.length)} loại`;
  $('clearCartBtn').disabled=cart.length===0;
  $('checkoutBtn').disabled=cart.length===0;
  $('cartPageTotal').textContent=price(total);
  $('cartPageItems').innerHTML=valid.length?valid.map(c=>{
    const p=c.product,img=safeUrl(p.image_url);
    return `<div class="cart-page-line"><div class="cart-page-thumb ${h(p.category)}">${img?`<img src="${h(img)}" alt="">`:h(icons[p.category]||'☕')}</div>
      <div class="cart-page-detail"><strong>${h(p.name)}</strong><small>${price(p.price)} / món</small><button class="link-btn cart-remove" data-action="remove-cart" data-id="${h(p.id)}">Xóa khỏi giỏ</button></div>
      <div class="cart-page-controls"><div class="qty-controls"><button data-action="cart-minus" data-id="${h(p.id)}" aria-label="Giảm ${h(p.name)}">−</button><span>${num(c.quantity)}</span><button data-action="cart-plus" data-id="${h(p.id)}" aria-label="Tăng ${h(p.name)}">＋</button></div><strong>${price(Number(p.price)*c.quantity)}</strong></div></div>`;
  }).join(''):'<div class="cart-page-empty"><span>🛒</span><h3>Giỏ hàng đang trống</h3><p>Hãy chọn món từ Menu & sản phẩm.</p><button class="btn btn-dark" data-switch="products">Xem menu →</button></div>';
  const old=$('cartCustomer').value;
  $('cartCustomer').innerHTML='<option value="">Khách lẻ</option>'+customers.map(c=>`<option value="${h(c.id)}">${h(c.name)}</option>`).join('');
  if(customers.some(c=>c.id===old))$('cartCustomer').value=old;
}
async function submitCartOrder({customerId,paymentMethod,note}){
  if(!cart.length){toast('Giỏ hàng chưa có món.','error');return false;}
  if(cart.some(c=>!products.some(p=>p.id===c.product_id&&p.available))){toast('Giỏ có món đã ngừng bán. Hãy kiểm tra lại.','error');renderCartPage();return false;}
  if(demo || !sb || !user){
    createPreviewOrder({customerId,paymentMethod,note});
    persistDemoState();
  }else{
    const {error}=await sb.rpc('cafe_create_order',{p_customer_id:customerId||null,p_items:cart,p_note:note||'',p_payment_method:paymentMethod||'cash'});
    if(error)throw error;
  }
  cart=[];persistCart();renderCartPage();renderCart();
  $('cartNote').value='';
  if(!demo)await loadData(); else render();
  openView('orders');
  toast(demo?'Đã tạo đơn trong bản xem trước (lưu trên trình duyệt).':'Đã tạo đơn hàng thành công.','success');
  return true;
}
function previewFileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Không đọc được ảnh.'));reader.readAsDataURL(file);
  });
}

function loadDemo() {
  const entries = [
    ['Cà phê sữa đá','coffee',32000,'Vị cà phê Việt Nam đậm đà và sữa đặc thơm béo'],
    ['Bạc xỉu','coffee',35000,'Ngọt dịu, nhiều sữa, tinh tế mỗi ngụm'],
    ['Cold Brew','coffee',49000,'Chiết xuất lạnh ủ lâu, hậu vị thanh sạch'],
    ['Trà đào cam sả','tea',45000,'Trái cây tươi và hương trà mát lạnh'],
    ['Matcha Latte','tea',52000,'Matcha béo mịn, thơm tự nhiên'],
    ['Croissant bơ','cake',39000,'Bánh sừng bò vàng giòn mỗi sáng']
  ];
  products = entries.map((x,i) => ({id:`demo-p${i}`,name:x[0],category:x[1],price:x[2],description:x[3],available:true}));
  customers = ['Nguyễn Minh Anh','Trần Quốc Bảo','Lê Thanh Hà','Phạm Gia Huy','Khách quen'].map((name,i) => ({id:`demo-c${i}`,name,phone:`090${i} 123 45${i}`,email:'',notes:i===0?'Khách thân thiết':''}));
  const spec = [[0,1,2,'done','paid'],[0,3,1,'preparing','unpaid'],[1,2,4,'done','paid'],[1,0,3,'done','paid'],[2,3,2,'new','unpaid'],[2,4,1,'done','paid'],[3,1,0,'done','paid'],[4,0,2,'done','paid'],[5,5,1,'done','paid'],[6,3,3,'done','paid']];
  orders = spec.map(([days,prodIdx,qty,status,payment_status],i) => {
    const p = products[prodIdx], created_at = daysAgo(days), customer_id = customers[i%customers.length].id;
    return {id:`demo-o${i}`,order_code:`MC-261018-${String(i+15).padStart(4,'0')}`,customer_id,customers:{name:customers[i%customers.length].name},created_at,status,payment_status,payment_method:'cash',total:p.price*qty,paid_at:payment_status==='paid'?created_at:null,note:'',order_items:[{id:`item${i}`,product_name:p.name,quantity:qty,unit_price:p.price,line_total:p.price*qty}]};
  });
  try {
    const saved=JSON.parse(localStorage.getItem(DEMO_STATE_KEY)||'null');
    if(saved?.v===2 && Array.isArray(saved.products) && Array.isArray(saved.customers) && Array.isArray(saved.orders)){
      products=saved.products;customers=saved.customers;orders=saved.orders;
    }
  }catch(e){console.warn('Không đọc được dữ liệu xem trước.',e);}
}

function setLiveStatus(label, kind='') {
  const e = $('liveStatus'); e.className = `live-pill ${kind}`; e.innerHTML = '<i></i>' + h(label);
}
function openView(view) {
  currentView = titles[view] ? view : 'overview';
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden',v.id !== `view-${currentView}`));
  document.querySelectorAll('[data-view]').forEach(v => v.classList.toggle('active',v.dataset.view === currentView));
  $('headerTitle').textContent = titles[currentView];
  $('crumb').textContent = titles[currentView].replace('Quản lý ','');
  $('sidebar').classList.remove('open');
  $('mobileShade').classList.remove('show');
  render();
  window.scrollTo({top:0,behavior:'smooth'});
}

function render() {
  const activeOrders = orders.filter(o=>o.status!=='cancelled');
  const revenue = activeOrders.filter(o=>o.payment_status==='paid').reduce((a,o)=>a+Number(o.total),0);
  const today = dateKey(new Date());
  $('statRevenue').textContent = price(revenue);
  $('statToday').textContent = num(orders.filter(o=>dateKey(o.created_at)===today).length);
  $('statUnpaid').textContent = num(activeOrders.filter(o=>o.payment_status==='unpaid').length);
  $('statProducts').textContent = num(products.length);
  $('statProductDesc').textContent = `${products.filter(p=>p.available).length} sản phẩm đang bán`;
  $('navPending').textContent = num(activeOrders.filter(o=>o.status==='new').length);
  $('todayText').textContent = new Date().toLocaleDateString('vi-VN',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  renderChart();
  renderRecent();
  renderOrders();
  renderProducts();
  renderCustomers();
  renderReports();
  renderCartPage();
}
const emptyTr = (text, cols) => `<tr><td colspan="${cols}"><div class="empty-state"><span class="empty-icon">☕</span><strong>${h(text)}</strong><span>Thêm dữ liệu để bắt đầu.</span></div></td></tr>`;
const statusTag = status => `<span class="status-tag status-${h(status)}">${h(statusLabels[status]||status)}</span>`;

function renderRecent() {
  const list = [...orders].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);
  $('recentOrdersBody').innerHTML = list.length ? list.map(o=>`<tr><td><strong>${h(o.order_code)}</strong></td><td>${h(o.customers?.name || 'Khách lẻ')}</td><td>${h(fmtDate(o.created_at))}</td><td><strong>${price(o.total)}</strong></td><td>${statusTag(o.status)}</td></tr>`).join('') : emptyTr('Chưa có đơn hàng',5);
}
function renderChart() {
  const data = Array.from({length:7},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()-6+i);
    const key = dateKey(d);
    const total = orders.filter(o=>o.payment_status==='paid'&&o.status!=='cancelled'&&o.paid_at&&dateKey(o.paid_at)===key).reduce((s,o)=>s+Number(o.total),0);
    return {day:d.toLocaleDateString('vi-VN',{weekday:'short'}),total};
  });
  const max = Math.max(1,...data.map(x=>x.total));
  $('revenueChart').innerHTML = data.map(row=>`<div class="chart-col"><div class="bar" style="height:${Math.max(2,Math.round(row.total/max*170))}px" data-value="${price(row.total)}"></div><span class="day">${h(row.day)}</span></div>`).join('');
  $('weekTotal').textContent = price(data.reduce((s,r)=>s+r.total,0));
}

function orderSearchList() {
  const q = $('orderSearch').value.toLocaleLowerCase('vi').trim();
  const status = $('orderStatusFilter').value;
  return [...orders].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).filter(o =>
    (status==='all'||o.status===status) && (!q || [o.order_code,o.customers?.name,o.note].some(v=>String(v||'').toLocaleLowerCase('vi').includes(q)))
  );
}
function renderOrders() {
  const data = orderSearchList();
  $('ordersCount').textContent = `Hiển thị ${data.length} / ${orders.length} đơn hàng`;
  $('ordersBody').innerHTML = data.length ? data.map(o=>`<tr>
    <td><strong>${h(o.order_code)}</strong><small>${o.order_items?.length||0} dòng món</small></td>
    <td>${h(o.customers?.name || 'Khách lẻ')}</td>
    <td>${h(fmtDate(o.created_at))}</td>
    <td><strong>${price(o.total)}</strong></td>
    <td><select class="table-select" data-kind="payment" data-id="${h(o.id)}" aria-label="Trạng thái thanh toán" ${o.status==='cancelled'?'disabled':''}><option value="unpaid" ${o.payment_status==='unpaid'?'selected':''}>Chưa thu</option><option value="paid" ${o.payment_status==='paid'?'selected':''}>Đã thu</option></select></td>
    <td><select class="table-select" data-kind="status" data-id="${h(o.id)}" aria-label="Trạng thái đơn"><option value="new" ${o.status==='new'?'selected':''}>Mới tạo</option><option value="preparing" ${o.status==='preparing'?'selected':''}>Đang pha</option><option value="done" ${o.status==='done'?'selected':''}>Hoàn tất</option><option value="cancelled" ${o.status==='cancelled'?'selected':''}>Đã hủy</option></select></td>
    <td><button class="mini-action" data-action="view-order" data-id="${h(o.id)}">Chi tiết ↗</button></td>
  </tr>`).join('') : emptyTr('Không tìm thấy đơn hàng',7);
}
function renderProducts() {
  const q = $('productSearch').value.toLocaleLowerCase('vi').trim();
  const category = $('categoryFilter').value;
  const list = [...products].sort((a,b)=>a.name.localeCompare(b.name,'vi')).filter(p=>(category==='all'||p.category===category)&&(!q||[p.name,p.description,categoryLabels[p.category]].some(v=>String(v||'').toLocaleLowerCase('vi').includes(q))));
  $('productsEmpty').classList.toggle('hidden',products.length>0);
  $('productsGrid').innerHTML = list.length ? list.map(p=>{
    const img = safeUrl(p.image_url);
    return `<article class="product-card"><div class="product-thumb ${h(p.category)}">${h(icons[p.category]||'☕')}${img?`<img src="${h(img)}" alt="${h(p.name)}" loading="lazy">`:''}<span class="floating-status">${p.available?'● Đang bán':'○ Tạm ẩn'}</span></div>
      <div class="product-card-body"><span class="product-category">${h(categoryLabels[p.category]||'Khác')}</span><h3>${h(p.name)}</h3><p>${h(p.description||'Thức uống được yêu thích tại quán.')}</p>
      <div class="product-card-bottom"><strong>${price(p.price)}</strong></div>
      <button class="product-cart-btn" data-action="add-cart" data-id="${h(p.id)}" ${p.available?'':'disabled'}>${p.available?'＋ Thêm vào giỏ':'Tạm ngừng bán'}</button>
      <div class="product-admin-actions"><span>QUẢN TRỊ MÓN</span><div class="card-actions"><button data-action="edit-product" data-id="${h(p.id)}" title="Sửa sản phẩm">✎ Sửa</button><button data-action="toggle-product" data-id="${h(p.id)}" title="Bật/tắt kinh doanh">${p.available?'Ẩn món':'Mở bán'}</button><button class="danger-action" data-action="delete-product" data-id="${h(p.id)}" title="Xóa sản phẩm">✕ Xóa</button></div></div>
      </div></article>`;
  }).join('') : (products.length ? `<div class="empty-state">Không tìm thấy sản phẩm phù hợp.</div>` : '');
}
function renderCustomers() {
  const q=$('customerSearch').value.toLocaleLowerCase('vi').trim();
  const list = [...customers].sort((a,b)=>a.name.localeCompare(b.name,'vi')).filter(c=>[c.name,c.phone,c.email].some(v=>String(v||'').toLocaleLowerCase('vi').includes(q)));
  $('customerCount').textContent = `${num(customers.length)} khách hàng`;
  $('customersBody').innerHTML = list.length ? list.map(c=>{
    const count=orders.filter(o=>o.customer_id===c.id).length;
    return `<tr><td><div class="customer-cell"><span class="avatar">${h(c.name?.charAt(0)?.toUpperCase()||'K')}</span><strong>${h(c.name)}</strong></div></td><td>${h(c.phone||'—')}</td><td>${h(c.email||'—')}</td><td>${count} đơn</td><td>${h((c.notes||'').slice(0,50)||'—')}</td><td><button class="mini-action" data-action="edit-customer" data-id="${h(c.id)}">Sửa</button> <button class="mini-action" data-action="delete-customer" data-id="${h(c.id)}">Xóa</button></td></tr>`;
  }).join('') : emptyTr('Chưa có khách hàng',6);
}
function renderReports() {
  const active=orders.filter(o=>o.status!=='cancelled');
  const sum=active.filter(o=>o.payment_status==='paid').reduce((s,o)=>s+Number(o.total),0);
  $('reportRevenue').textContent=price(sum);
  $('reportAov').textContent=price(active.length?active.reduce((s,o)=>s+Number(o.total),0)/active.length:0);
  $('reportOrders').textContent=num(orders.length);
  const tally=new Map();
  for(const o of active)for(const item of (o.order_items||[])){
    const key=item.product_name;
    tally.set(key,(tally.get(key)||0)+Number(item.quantity));
  }
  const top=[...tally].sort((a,b)=>b[1]-a[1]).slice(0,5);
  $('topProducts').innerHTML=top.length?`<div class="report-list">${top.map(([name,qty],i)=>`<div class="report-item"><span class="rank">${i+1}</span><span class="grow">${h(name)}</span><strong>${qty} món</strong></div>`).join('')}</div>`:'<div class="empty-state">Chưa có dữ liệu bán hàng.</div>';
  $('orderBreakdown').innerHTML=`<div class="report-list">${Object.entries(statusLabels).map(([s,label])=>`<div class="report-item"><span class="grow">${statusTag(s)}</span><strong>${orders.filter(o=>o.status===s).length} đơn</strong></div>`).join('')}</div>`;
}

function openModal(title, subtitle, content, opts={}) {
  $('modalRoot').innerHTML=`<div class="modal-box ${opts.wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${h(title)}"><div class="modal-top"><div><h2>${h(title)}</h2><p>${h(subtitle)}</p></div><button class="close-modal" data-action="close-modal" aria-label="Đóng">×</button></div>${content}</div>`;
  $('modalRoot').classList.remove('hidden');
  document.body.style.overflow='hidden';
  $('modalRoot').querySelector('input,select,button')?.focus();
}
function closeModal(){ $('modalRoot').classList.add('hidden'); $('modalRoot').innerHTML=''; document.body.style.overflow=''; }
const foot = label => `<div class="modal-foot"><button type="button" class="btn btn-outline" data-action="close-modal">Đóng</button><button type="submit" form="modalForm" class="btn btn-dark" id="modalSave">${h(label)}</button></div>`;

function productModal(item=null) {
  openModal(item?'Sửa sản phẩm':'Thêm sản phẩm', 'Thông tin menu của cửa hàng', `<form id="modalForm"><div class="modal-body"><div class="form-grid">
  <div class="form-field span-2"><label for="pName">Tên món *</label><input id="pName" name="name" maxlength="140" required value="${h(item?.name||'')}" placeholder="Ví dụ: Cà phê sữa đá"></div>
  <div class="form-field"><label for="pCategory">Danh mục *</label><select id="pCategory" name="category">${Object.entries(categoryLabels).map(([k,v])=>`<option value="${k}" ${item?.category===k?'selected':''}>${v}</option>`).join('')}</select></div>
  <div class="form-field"><label for="pPrice">Giá bán (VNĐ) *</label><input id="pPrice" name="price" type="number" min="0" max="999999999" step="100" required value="${item?.price??''}" placeholder="35000"></div>
  <div class="form-field span-2"><label for="pDesc">Mô tả</label><textarea id="pDesc" name="description" maxlength="800" placeholder="Một vài dòng giới thiệu về thức uống...">${h(item?.description||'')}</textarea></div>
  <div class="form-field span-2"><label for="pImg">Hình ảnh món (tùy chọn)</label><input id="pImg" type="file" accept="image/png,image/jpeg,image/webp"><small>JPG, PNG, WEBP · Dung lượng tối đa 5 MB · Lưu trong Supabase Storage.</small></div>
  <div class="form-field span-2"><label><input id="pAvailable" type="checkbox" ${item?.available===false?'':'checked'}> Sản phẩm đang bán</label></div>
  </div></div></form>${foot(item?'Lưu thay đổi':'Tạo sản phẩm')}`);
  $('modalForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const name=$('pName').value.trim(), n=Number($('pPrice').value), file=$('pImg').files[0];
    if(!name||!Number.isFinite(n)||n<0){toast('Vui lòng kiểm tra tên và giá bán.','error');return;}
    const btn=$('modalSave');btn.disabled=true;btn.textContent='Đang lưu...';
    try{
      if(demo || !sb || !user){
        if(file && (!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880)) throw Error('Ảnh phải là JPG/PNG/WEBP và không vượt 5MB.');
        if(file && file.size > 950000) throw Error('Ảnh bản xem trước cần nhỏ hơn 950 KB để lưu trong trình duyệt.');
        const previewImageUrl=file?await previewFileToDataUrl(file):null;
        savePreviewProduct(item,{name,category:$('pCategory').value,price:n,description:$('pDesc').value.trim(),available:$('pAvailable').checked,image_url:previewImageUrl});
        closeModal(); render(); toast(item?'Đã cập nhật sản phẩm trong bản xem trước.':'Đã thêm sản phẩm trong bản xem trước.','success');
        return;
      }
      let image_url=item?.image_url||null;
      if(file){
        if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880)throw Error('Ảnh phải là JPG/PNG/WEBP và không vượt 5MB.');
        const ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' }[file.type];
        const path=`${user.id}/${crypto.randomUUID()}.${ext}`;
        const {error:upError}=await sb.storage.from('cafe-products').upload(path,file,{contentType:file.type,upsert:false});
        if(upError)throw upError;
        image_url=sb.storage.from('cafe-products').getPublicUrl(path).data.publicUrl;
      }
      const value={name,category:$('pCategory').value,price:n,description:$('pDesc').value.trim(),available:$('pAvailable').checked,image_url};
      const q=item?sb.from('products').update(value).eq('id',item.id):sb.from('products').insert({...value,owner_id:user.id});
      const {error}=await q; if(error)throw error;
      closeModal();toast(item?'Đã cập nhật sản phẩm.':'Đã thêm sản phẩm.','success');await loadData();
    }catch(err){toast(err.message||'Không thể lưu sản phẩm.','error');}
    finally{if($('modalSave')){$('modalSave').disabled=false;$('modalSave').textContent='Lưu sản phẩm';}}
  });
}
function customerModal(item=null) {
  openModal(item?'Sửa khách hàng':'Thêm khách hàng','Thông tin khách và chăm sóc khách quen',`<form id="modalForm"><div class="modal-body"><div class="form-grid">
    <div class="form-field span-2"><label for="cName">Họ tên *</label><input id="cName" maxlength="140" required value="${h(item?.name||'')}" placeholder="Tên khách hàng"></div>
    <div class="form-field"><label for="cPhone">Số điện thoại</label><input id="cPhone" maxlength="30" value="${h(item?.phone||'')}" placeholder="09xxxxxxxx"></div>
    <div class="form-field"><label for="cEmail">Email</label><input id="cEmail" type="email" maxlength="180" value="${h(item?.email||'')}" placeholder="email@example.com"></div>
    <div class="form-field span-2"><label for="cNotes">Ghi chú</label><textarea id="cNotes" maxlength="1000" placeholder="Sở thích, ghi chú về khách hàng...">${h(item?.notes||'')}</textarea></div>
  </div></div></form>${foot(item?'Lưu thay đổi':'Thêm khách hàng')}`);
  $('modalForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const btn=$('modalSave');btn.disabled=true;
    try{
      const value={name:$('cName').value.trim(),phone:$('cPhone').value.trim(),email:$('cEmail').value.trim(),notes:$('cNotes').value.trim()};
      if(!value.name){toast('Vui lòng nhập họ tên khách hàng.','error');return;}
      if(demo || !sb || !user){
        savePreviewCustomer(item, value);
        closeModal(); render(); toast('Đã lưu khách hàng trong bản xem trước.','success');
        return;
      }
      const q=item?sb.from('customers').update(value).eq('id',item.id):sb.from('customers').insert({...value,owner_id:user.id});
      const {error}=await q;if(error)throw error;
      closeModal();toast('Đã lưu khách hàng.','success');await loadData();
    }catch(err){toast(err.message||'Lỗi lưu khách hàng.','error');}
    finally{if($('modalSave'))$('modalSave').disabled=false;}
  });
}
function orderModal() {
  if(!products.some(p=>p.available)){toast('Menu chưa có sản phẩm đang bán. Hãy thêm sản phẩm trước.','error');openView('products');return;}
  openModal('Tạo đơn hàng mới','Chọn sản phẩm và số lượng. Giá được xác nhận lại trên máy chủ.',`<form id="modalForm"><div class="modal-body"><div class="form-grid">
    <div class="form-field"><label for="oCustomer">Khách hàng</label><select id="oCustomer"><option value="">Khách lẻ</option>${customers.map(c=>`<option value="${h(c.id)}">${h(c.name)}</option>`).join('')}</select></div>
    <div class="form-field"><label for="oMethod">Phương thức thanh toán</label><select id="oMethod"><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option><option value="card">Thẻ (ghi nhận thủ công)</option></select></div>
    <div class="form-field span-2"><label for="oProduct">Chọn món</label><select id="oProduct"><option value="">— Chọn sản phẩm để thêm —</option>${products.filter(p=>p.available).map(p=>`<option value="${h(p.id)}">${h(p.name)} — ${price(p.price)}</option>`).join('')}</select></div>
    <div class="form-field span-2"><label>Giỏ hàng</label><div id="cartList" class="cart-list"></div><div class="cart-total"><span>Tổng tạm tính</span><strong id="cartTotal">0 ₫</strong></div></div>
    <div class="form-field span-2"><label for="oNote">Ghi chú đơn hàng</label><textarea id="oNote" maxlength="1000" placeholder="Ít đá, giảm đường, mang đi..."></textarea></div>
  </div><small style="color:#a29a8d;font-size:11px">Thanh toán được ghi nhận sau khi tạo đơn, chưa tích hợp cổng thanh toán tự động.</small></div></form>${foot('Tạo đơn hàng')}`,{wide:true});
  $('oProduct').addEventListener('change',e=>{const pid=e.target.value;if(!pid)return;addCartItem(pid);e.target.value='';});
  $('modalForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=$('modalSave');btn.disabled=true;btn.textContent='Đang tạo đơn...';
    try{
      const result=await submitCartOrder({customerId:$('oCustomer').value||null,paymentMethod:$('oMethod').value,note:$('oNote').value.trim()});
      if(result)closeModal();
    }catch(err){toast(err.message||'Không thể tạo đơn.','error');}
    finally{if($('modalSave')){$('modalSave').disabled=false;$('modalSave').textContent='Tạo đơn hàng';}}
  });
  renderCart();
}
function renderCart(){
  if(!$('cartList'))return;
  $('cartList').innerHTML=cart.length?cart.map(c=>{
    const p=products.find(p=>p.id===c.product_id);if(!p)return '';
    return `<div class="cart-item"><div><strong>${h(p.name)}</strong><small>${price(p.price)} / món</small></div><div class="qty-controls"><button type="button" data-action="cart-minus" data-id="${h(p.id)}">−</button><span>${c.quantity}</span><button type="button" data-action="cart-plus" data-id="${h(p.id)}">＋</button></div><div class="item-price">${price(p.price*c.quantity)}</div></div>`;
  }).join(''):'<div class="empty-state" style="padding:20px">Chưa có món nào được chọn.</div>';
  $('cartTotal').textContent=price(cart.reduce((s,c)=>s+Number(products.find(p=>p.id===c.product_id)?.price||0)*c.quantity,0));
  if($('navCartCount'))$('navCartCount').textContent=num(cart.reduce((s,c)=>s+c.quantity,0));
}
function detailModal(order){
  const entries=(order.order_items||[]).map(x=>`<div class="detail-line"><span>${h(x.product_name)} × ${x.quantity}<small style="display:block;margin-top:5px">${price(x.unit_price)} / món</small></span><strong>${price(x.line_total)}</strong></div>`).join('');
  const methods={cash:'Tiền mặt',transfer:'Chuyển khoản',card:'Thẻ (ghi nhận thủ công)'};
  openModal(`Đơn hàng ${order.order_code}`,'Chi tiết sản phẩm và thanh toán',`<div class="modal-body">
    <div class="detail-line"><span>Khách hàng</span><strong>${h(order.customers?.name||'Khách lẻ')}</strong></div>
    <div class="detail-line"><span>Thời gian</span><strong>${h(fmtDate(order.created_at))}</strong></div>
    <div class="detail-line"><span>Trạng thái</span>${statusTag(order.status)}</div>
    <div class="detail-line"><span>Thanh toán</span><strong>${h(paymentLabels[order.payment_status])}</strong></div>
    <div class="detail-line"><span>Hình thức</span><strong>${h(methods[order.payment_method]||order.payment_method)}</strong></div>
    <h3 style="margin:23px 0 7px;font-size:13px">Chi tiết món</h3>${entries}
    <div class="cart-total"><span>Tổng cộng</span><strong>${price(order.total)}</strong></div>
    ${order.note?`<div class="detail-line"><span>Ghi chú</span><strong>${h(order.note)}</strong></div>`:''}
    <div style="color:#a09a92;font-size:11px;margin-top:18px">Giá bán được lưu tại thời điểm tạo đơn để giữ lịch sử chính xác.</div>
  </div><div class="modal-foot"><button class="btn btn-outline" data-action="close-modal">Đóng</button></div>`);
}

async function handleAction(action, idValue) {
  if(action==='close-modal'){closeModal();return;}
  if(action==='new-order'){orderModal();return;}
  if(action==='add-cart'){addCartItem(idValue);return;}
  if(action==='remove-cart'){cart=cart.filter(c=>c.product_id!==idValue);persistCart();renderCart();renderCartPage();return;}
  if(action==='clear-cart'){if(cart.length&&confirm('Xóa tất cả món khỏi giỏ hàng?')){cart=[];persistCart();renderCart();renderCartPage();toast('Đã làm trống giỏ hàng.');}return;}
  if(action==='new-product'){productModal();return;}
  if(action==='new-customer'){customerModal();return;}
  if(action==='view-order'){const o=orders.find(o=>o.id===idValue);if(o)detailModal(o);return;}
  if(action==='edit-product'){const p=products.find(p=>p.id===idValue);if(p)productModal(p);return;}
  if(action==='edit-customer'){const c=customers.find(c=>c.id===idValue);if(c)customerModal(c);return;}
  if(action==='cart-plus' || action==='cart-minus'){
    updateCartQuantity(idValue,action==='cart-plus'?1:-1);return;
  }
  if(action==='toggle-product'){
    const p=products.find(x=>x.id===idValue);if(!p)return;
    if(demo || !sb || !user){ p.available=!p.available; persistDemoState(); render(); toast('Đã đổi trạng thái món trong bản xem trước.','success'); return; }
    const {error}=await sb.from('products').update({available:!p.available}).eq('id',p.id);
    if(error)toast(error.message,'error');else{toast('Đã đổi trạng thái món.','success');await loadData();}return;
  }
  if(action==='delete-product'){
    const p=products.find(x=>x.id===idValue);if(!p||!confirm(`Xóa sản phẩm "${p.name}"? Lịch sử đơn hàng vẫn giữ tên và giá đã bán.`))return;
    if(demo || !sb || !user){ products=products.filter(x=>x.id!==p.id); cart=cart.filter(c=>c.product_id!==p.id);persistCart();persistDemoState(); render(); toast('Đã xóa sản phẩm trong bản xem trước.','success'); return; }
    const {error}=await sb.from('products').delete().eq('id',p.id);
    if(error)toast(error.message,'error');else{toast('Đã xóa sản phẩm.','success');await loadData();}return;
  }
  if(action==='delete-customer'){
    const c=customers.find(x=>x.id===idValue);if(!c||!confirm(`Xóa khách hàng "${c.name}"? Các đơn cũ chuyển thành khách lẻ.`))return;
    if(demo || !sb || !user){ customers=customers.filter(x=>x.id!==c.id); orders=orders.map(o=>o.customer_id===c.id?{...o, customer_id:null, customers:{name:'Khách lẻ'}}:o); persistDemoState(); render(); toast('Đã xóa khách hàng trong bản xem trước.','success'); return; }
    const {error}=await sb.from('customers').delete().eq('id',c.id);
    if(error)toast(error.message,'error');else{toast('Đã xóa khách hàng.','success');await loadData();}
  }
}

async function loadData(){
  if(demo){render();return;}
  if(refreshBusy){refreshAgain=true;return;}
  refreshBusy=true;
  try{
    const [p,c,o]=await Promise.all([
      sb.from('products').select('id,name,category,price,description,image_url,available,created_at').order('created_at',{ascending:false}).limit(1000),
      sb.from('customers').select('id,name,phone,email,notes,created_at').order('created_at',{ascending:false}).limit(1000),
      sb.from('orders').select('id,order_code,customer_id,status,payment_status,payment_method,total,note,created_at,paid_at,customers(name),order_items(id,product_name,quantity,unit_price,line_total)').order('created_at',{ascending:false}).limit(1000)
    ]);
    const err=p.error||c.error||o.error;if(err)throw err;
    products=p.data||[];customers=c.data||[];orders=o.data||[];
    render();
  }catch(err){toast('Lỗi tải dữ liệu: '+(err.message||err),'error');console.error(err);}
  finally{refreshBusy=false;if(refreshAgain){refreshAgain=false;void loadData();}}
}
function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void loadData(),350);}
function connectRealtime(){
  if(!sb||!user)return;
  if(channel)sb.removeChannel(channel);
  channel=sb.channel(`cafe-workspace-${user.id}`);
  for(const table of ['products','customers','orders','order_items']){
    channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`owner_id=eq.${user.id}`},scheduleRefresh);
  }
  channel.subscribe(status=>{
    if(status==='SUBSCRIBED')setLiveStatus('Realtime đang bật','connected');
    else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED')setLiveStatus('Mất kết nối realtime','offline');
  });
}
function csvExport(){
  const rows=[['Mã đơn','Ngày tạo','Khách hàng','Trạng thái','Thanh toán','Phương thức','Tổng tiền','Ghi chú']];
  orders.forEach(o=>rows.push([o.order_code,fmtDate(o.created_at),o.customers?.name||'Khách lẻ',statusLabels[o.status],paymentLabels[o.payment_status],o.payment_method,o.total,o.note]));
  const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const csv='\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`moc-cafe-don-hang-${dateKey(new Date())}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function seedProducts(){
  if(products.length){toast('Menu đã có sản phẩm.','error');return;}
  const examples=[['Cà phê sữa đá','coffee',32000],['Bạc xỉu','coffee',35000],['Cold Brew','coffee',49000],['Trà đào cam sả','tea',45000],['Matcha Latte','tea',52000],['Croissant bơ','cake',39000]];
  const btn=$('seedProductsBtn');btn.disabled=true;
  try{
    if(demo || !sb || !user){
      products=examples.map(([name,category,price],i)=>({id:`preview-seed-${Date.now()}-${i}`,name,category,price,description:'',available:true}));
      persistDemoState();render();toast('Đã khôi phục menu mẫu trong bản xem trước.','success');return;
    }
    const {error}=await sb.from('products').insert(examples.map(([name,category,price])=>({owner_id:user.id,name,category,price,available:true})));
    if(error)throw error;toast('Đã tạo menu mẫu. Có thể sửa/xóa từng món.','success');await loadData();
  }catch(err){toast(err.message,'error')}finally{btn.disabled=false;}
}

function bindUI(){
  document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>openView(btn.dataset.view)));
  document.addEventListener('click',e=>{
    const sw=e.target.closest('[data-switch]');if(sw){openView(sw.dataset.switch);return;}
    const action=e.target.closest('[data-action]');if(action)void handleAction(action.dataset.action,action.dataset.id);
  });
  $('modalRoot').addEventListener('mousedown',e=>{if(e.target===$('modalRoot'))closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modalRoot').classList.contains('hidden'))closeModal();});
  ['orderSearch','orderStatusFilter','productSearch','categoryFilter','customerSearch'].forEach(key=>$(key).addEventListener(key.includes('Filter')?'change':'input',()=>{
    if(key.startsWith('order'))renderOrders();else if(key.startsWith('product')||key==='categoryFilter')renderProducts();else renderCustomers();
  }));
  $('ordersBody').addEventListener('change',async e=>{
    const el=e.target.closest('[data-kind]');if(!el)return;
    const o=orders.find(o=>o.id===el.dataset.id);if(!o)return;
    if(demo || !sb || !user){
      if(el.dataset.kind==='status' && el.value==='cancelled' && o.payment_status==='paid'){
        el.value=o.status;toast('Không thể hủy đơn đã thu tiền.','error');return;
      }
      if(el.dataset.kind==='payment'){
        o.payment_status = el.value;
        o.paid_at = el.value==='paid' ? new Date().toISOString() : null;
      }else{
        o.status = el.value;
        if(el.value==='cancelled'){ o.payment_status='unpaid'; o.paid_at=null; }
      }
      persistDemoState(); render();
      toast('Đã cập nhật đơn hàng trong bản xem trước.','success');
      return;
    }
    const fn=el.dataset.kind==='payment'?'cafe_set_order_payment':'cafe_set_order_status';
    const args=el.dataset.kind==='payment'?{p_order_id:o.id,p_payment_status:el.value}:{p_order_id:o.id,p_status:el.value};
    el.disabled=true;
    const {error}=await sb.rpc(fn,args);
    el.disabled=false;
    if(error){toast(error.message,'error');el.value=el.dataset.kind==='payment'?o.payment_status:o.status;}
    else{toast('Cập nhật đơn hàng thành công.','success');await loadData();}
  });
  $('checkoutForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const button=$('checkoutBtn');button.disabled=true;button.textContent='Đang xử lý...';
    try{ await submitCartOrder({customerId:$('cartCustomer').value||null,paymentMethod:$('cartMethod').value,note:$('cartNote').value.trim()}); }
    catch(err){toast(err.message||'Không thể tạo đơn hàng.','error');}
    finally{button.textContent='✓ Tạo đơn hàng';button.disabled=!cart.length;}
  });
  $('refreshBtn').addEventListener('click',()=>{void loadData();toast('Đang làm mới dữ liệu...');});
  $('logoutBtn').addEventListener('click',async()=>{if(demo){location.href='./login.html';return;}await sb.auth.signOut();location.replace('./login.html');});
  $('menuBtn').addEventListener('click',()=>{$('sidebar').classList.add('open');$('mobileShade').classList.add('show');});
  $('mobileShade').addEventListener('click',()=>{$('sidebar').classList.remove('open');$('mobileShade').classList.remove('show');});
  $('seedProductsBtn').addEventListener('click',()=>void seedProducts());
  $('exportCsvBtn').addEventListener('click',csvExport);
}
async function init(){
  bindUI();
  if(demo){
    loadDemo();restoreCart();$('userName').textContent='Bản xem trước';$('userEmail').textContent='Dữ liệu minh họa';setLiveStatus('Demo · lưu tại trình duyệt','offline');render();return;
  }
  try{
    const {data:{user:authUser},error}=await sb.auth.getUser();
    if(error||!authUser){location.replace('./login.html');return;}
    user=authUser;
    const name=authUser.user_metadata?.full_name?.trim()||authUser.email?.split('@')[0]||'Quản lý';
    $('userName').textContent=name;$('userAvatar').textContent=name[0].toUpperCase();$('userEmail').textContent=authUser.email||'';
    await loadData();restoreCart();render();connectRealtime();
    sb.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT')location.replace('./login.html');});
  }catch(err){console.error(err);toast('Không kết nối được Supabase. Kiểm tra cấu hình và mạng.','error');setLiveStatus('Lỗi kết nối','offline');}
}
void init();
