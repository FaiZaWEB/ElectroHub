// ==========================================
// 1. ตั้งค่าการเชื่อมต่อ Supabase และตัวแปรกลางของระบบ
// ==========================================
const SUPABASE_URL = 'https://zlpxxwauxgwsvvukfqmx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mTmE2KIwTN0vsM7nDlePTg_rHJwCaNn';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PROMPTPAY_NUMBER = "0623910008";
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1570114848656724109/ZYP72Deasv9zoUB-vdhG8ixueTXdWzmXV2FKWZ1IIyo3QMVIpgh3_udCftm-nuzyxrAY";

// สถานะกลาง (แชร์ข้อมูลตะกร้าร่วมกันทุกหน้าผ่าน localStorage)
let cart = JSON.parse(localStorage.getItem('electrohub_cart')) || [];
let appliedCoupon = JSON.parse(localStorage.getItem('electrohub_coupon')) || null; // เก็บคูปองที่กำลังใช้งาน
let currentUser = null;
let isCartOpen = false;
let currentPendingOrder = null;

function saveCartToStorage() {
    localStorage.setItem('electrohub_cart', JSON.stringify(cart));
}

function saveCouponToStorage() {
    if (appliedCoupon) {
        localStorage.setItem('electrohub_coupon', JSON.stringify(appliedCoupon));
    } else {
        localStorage.removeItem('electrohub_coupon');
    }
}

function formatPrice(price) {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        minimumFractionDigits: 0
    }).format(price || 0);
}

// ==========================================
// 2. ระบบตรวจสอบสถานะสมาชิก (Session & Auth)
// ==========================================
async function checkUserSession(onSessionReady = null) {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session && session.user) {
            const user = session.user;
            currentUser = {
                id: user.id,
                email: user.email,
                name: user.user_metadata?.display_name || user.email.split('@')[0]
            };
        } else {
            currentUser = null;
        }
        updateSharedAuthUI();
        if (typeof onSessionReady === 'function') onSessionReady(currentUser);
    } catch (err) {
        console.error("Session check error:", err);
    }
}

function updateSharedAuthUI() {
    const loginBtn = document.getElementById('login-btn');
    const userMenu = document.getElementById('user-menu');
    const userDisplayName = document.getElementById('user-display-name');
    const userAvatar = document.getElementById('user-avatar');

    if (!loginBtn || !userMenu) return;

    if (currentUser) {
        loginBtn.classList.add('hidden');
        userMenu.classList.remove('hidden');
        if (userDisplayName) userDisplayName.innerText = `คุณ${currentUser.name}`;
        if (userAvatar) userAvatar.innerText = currentUser.name.charAt(0).toUpperCase();
    } else {
        loginBtn.classList.remove('hidden');
        userMenu.classList.add('hidden');
    }
}

// ==========================================
// 3. ระบบคูปองส่วนลดในตะกร้า (Coupon System)
// ==========================================
async function applyCartCoupon() {
    const inputEl = document.getElementById('cart-coupon-input');
    if (!inputEl) return;

    const code = inputEl.value.trim().toUpperCase();
    if (!code) {
        showToast("กรุณากรอกรหัสคูปองส่วนลด", "error");
        return;
    }

    if (!currentUser) {
        showToast("กรุณาเข้าสู่ระบบก่อนใช้โค้ดส่วนลด", "error");
        return;
    }

    if (cart.length === 0) {
        showToast("กรุณาเพิ่มสินค้าลงตะกร้าก่อนใช้โค้ดส่วนลด", "error");
        return;
    }

    // ดึงรายการคูปองที่ผู้ใช้แลกไว้จาก Supabase User Metadata
    const { data: { user: fullUser }, error } = await supabaseClient.auth.getUser();
    if (error || !fullUser) {
        showToast("ไม่สามารถตรวจสอบคูปองได้ กรุณาลองใหม่", "error");
        return;
    }

    const userCoupons = fullUser.user_metadata?.redeemed_coupons || [];
    const matchedCoupon = userCoupons.find(c => c.code.toUpperCase() === code);

    if (!matchedCoupon) {
        showToast("ไม่พบรหัสคูปองนี้ในบัญชีของคุณ", "error");
        return;
    }

    if (matchedCoupon.used) {
        showToast("คูปองรหัสนี้ถูกใช้งานไปแล้ว", "error");
        return;
    }

    // เช็กยอดสั่งซื้อขั้นต่ำ (ถ้ามี)
    const subtotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    if (matchedCoupon.code.startsWith('HUB100') && subtotal < 1000) {
        showToast("คูปองนี้ใช้ได้เมื่อสั่งซื้อครบ ฿1,000 ขึ้นไป", "error");
        return;
    }

    appliedCoupon = {
        code: matchedCoupon.code,
        title: matchedCoupon.title,
        discountValue: matchedCoupon.discountValue
    };

    saveCouponToStorage();
    updateCartUI();
    showToast(`ใช้โค้ด <b>${matchedCoupon.code}</b> ลดเพิ่ม ${formatPrice(matchedCoupon.discountValue)} สำเร็จ!`, "success");
}

function removeCartCoupon() {
    appliedCoupon = null;
    saveCouponToStorage();
    const inputEl = document.getElementById('cart-coupon-input');
    if (inputEl) inputEl.value = '';
    updateCartUI();
    showToast("ยกเลิกการใช้โค้ดส่วนลดแล้ว");
}

// ==========================================
// 4. ระบบตะกร้าสินค้ากลาง (Shared Cart + คำนวณส่วนลด)
// ==========================================
function triggerCartBounce() {
    const cartBtn = document.getElementById('cart-nav-btn');
    if (!cartBtn) return;
    cartBtn.classList.remove('cart-bounce');
    void cartBtn.offsetWidth;
    cartBtn.classList.add('cart-bounce');
}

function toggleCart() {
    const sidebar = document.getElementById('cart-sidebar');
    const backdrop = document.getElementById('cart-backdrop');
    const panel = document.getElementById('cart-panel');
    if (!sidebar || !backdrop || !panel) return;

    isCartOpen = !isCartOpen;
    if (isCartOpen) {
        sidebar.classList.remove('invisible');
        setTimeout(() => {
            backdrop.classList.remove('opacity-0');
            panel.classList.remove('translate-x-full');
        }, 10);
    } else {
        backdrop.classList.add('opacity-0');
        panel.classList.add('translate-x-full');
        setTimeout(() => sidebar.classList.add('invisible'), 300);
    }
}

function addItemToSharedCart(productObj, openSidebar = false) {
    if (!productObj) return;
    const existingItem = cart.find(item => item.product.id === productObj.id && item.product.price === productObj.price);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ product: productObj, quantity: 1 });
    }

    saveCartToStorage();
    updateCartUI();
    triggerCartBounce();
    showToast(`เพิ่ม <b>${productObj.name}</b> ลงในตะกร้าแล้ว`);

    if (openSidebar && !isCartOpen) {
        toggleCart();
    }
}

function removeFromCart(index) {
    cart.splice(index, 1);
    if (cart.length === 0) {
        appliedCoupon = null;
        saveCouponToStorage();
    }
    saveCartToStorage();
    updateCartUI();
}

function updateQuantity(index, delta) {
    const item = cart[index];
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
        removeFromCart(index);
    } else {
        saveCartToStorage();
        updateCartUI();
    }
}

function updateCartUI() {
    const container = document.getElementById('cart-items-container');
    const emptyMsg = document.getElementById('empty-cart-msg');
    const cartCount = document.getElementById('cart-count');
    const cartTotal = document.getElementById('cart-total');

    // ส่วนแสดงผลคูปองและส่วนลดในตะกร้า
    const discountRow = document.getElementById('cart-discount-row');
    const discountAmountEl = document.getElementById('cart-discount-amount');
    const appliedCouponBadge = document.getElementById('applied-coupon-badge');
    const appliedCouponText = document.getElementById('applied-coupon-text');
    const couponInputGroup = document.getElementById('coupon-input-group');

    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (cartCount) cartCount.innerText = totalItems;

    if (!container || !emptyMsg || !cartTotal) return;

    if (cart.length === 0) {
        emptyMsg.style.display = 'flex';
        container.querySelectorAll('.cart-item').forEach(item => item.remove());
        cartTotal.innerText = '฿0';
        if (discountRow) discountRow.classList.add('hidden');
        if (appliedCouponBadge) appliedCouponBadge.classList.add('hidden');
        if (couponInputGroup) couponInputGroup.classList.remove('hidden');
        return;
    }

    emptyMsg.style.display = 'none';
    container.querySelectorAll('.cart-item').forEach(item => item.remove());

    let subtotalPrice = 0;
    cart.forEach((item, index) => {
        subtotalPrice += item.product.price * item.quantity;
        const itemEl = document.createElement('div');
        itemEl.className = 'cart-item flex items-center gap-4 bg-white p-3 border rounded-xl shadow-sm transition-all hover:shadow-md';
        itemEl.innerHTML = `
            <img src="${item.product.image}" alt="${item.product.name}" class="w-20 h-20 object-cover rounded-lg bg-gray-100">
            <div class="flex-1 min-w-0">
                <h4 class="text-sm font-semibold text-gray-900 truncate">${item.product.name}</h4>
                <div class="text-primary font-medium text-sm mt-1">${formatPrice(item.product.price)}</div>
                <div class="flex items-center mt-2 border rounded-lg w-fit">
                    <button onclick="updateQuantity(${index}, -1)" class="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded-l-lg transition"><i class="fa-solid fa-minus text-xs"></i></button>
                    <span class="px-3 text-sm font-medium w-8 text-center">${item.quantity}</span>
                    <button onclick="updateQuantity(${index}, 1)" class="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded-r-lg transition"><i class="fa-solid fa-plus text-xs"></i></button>
                </div>
            </div>
            <button onclick="removeFromCart(${index})" class="text-gray-400 hover:text-red-500 p-2 self-start transition">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
        container.appendChild(itemEl);
    });

    // คำนวณส่วนลดจากคูปอง (ไม่ให้ยอดสุทธิติดลบ)
    let discountValue = 0;
    if (appliedCoupon) {
        discountValue = Math.min(subtotalPrice, appliedCoupon.discountValue);
        if (discountRow) discountRow.classList.remove('hidden');
        if (discountAmountEl) discountAmountEl.innerText = `-${formatPrice(discountValue)}`;
        if (appliedCouponBadge) appliedCouponBadge.classList.remove('hidden');
        if (appliedCouponText) appliedCouponText.innerText = `${appliedCoupon.code} (-${formatPrice(discountValue)})`;
        if (couponInputGroup) couponInputGroup.classList.add('hidden');
    } else {
        if (discountRow) discountRow.classList.add('hidden');
        if (appliedCouponBadge) appliedCouponBadge.classList.add('hidden');
        if (couponInputGroup) couponInputGroup.classList.remove('hidden');
    }

    const finalPrice = Math.max(0, subtotalPrice - discountValue);
    cartTotal.innerText = formatPrice(finalPrice);
}

// ==========================================
// 5. ระบบชำระเงิน PromptPay QR และตัดสิทธิ์คูปอง
// ==========================================
function checkout() {
    if (cart.length === 0) {
        showToast("ตะกร้าสินค้าว่างเปล่า กรุณาเลือกสินค้าก่อน", "error");
        return;
    }

    if (!currentUser) {
        showToast("กรุณาเข้าสู่ระบบก่อนทำการสั่งซื้อสินค้า", "error");
        if (typeof openAuthModal === 'function') {
            openAuthModal('login');
        } else {
            setTimeout(() => { window.location.href = "./index.html"; }, 1200);
        }
        return;
    }

    const subtotalPrice = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    const discountValue = appliedCoupon ? Math.min(subtotalPrice, appliedCoupon.discountValue) : 0;
    const finalPrice = Math.max(0, subtotalPrice - discountValue);

    const qrUrl = `https://promptpay.io/${PROMPTPAY_NUMBER}/${finalPrice}.png`;

    const qrImg = document.getElementById('promptpay-qr-img');
    const numDisplay = document.getElementById('promptpay-num-display');
    const amountDisplay = document.getElementById('payment-amount-display');
    const payModal = document.getElementById('payment-modal');

    if (qrImg) qrImg.src = qrUrl;
    if (numDisplay) numDisplay.innerText = `พร้อมเพย์: ${PROMPTPAY_NUMBER}`;
    if (amountDisplay) {
        amountDisplay.innerText = formatPrice(finalPrice);
    }

    const orderItemsList = cart.map(item => ({
        id: item.product.id,
        name: item.product.name,
        price: item.product.price,
        quantity: item.quantity,
        image: item.product.image
    }));

    // ถ้ามีการใช้คูปองส่วนลด ให้บันทึกเป็นรายการส่วนลดท้ายบิลด้วย
    if (appliedCoupon && discountValue > 0) {
        orderItemsList.push({
            id: 'COUPON',
            name: `ส่วนลดคูปอง (${appliedCoupon.code})`,
            price: -discountValue,
            quantity: 1,
            image: 'https://cdn-icons-png.flaticon.com/512/879/879757.png'
        });
    }

    currentPendingOrder = {
        totalPrice: finalPrice,
        couponUsed: appliedCoupon ? appliedCoupon.code : null,
        items: orderItemsList
    };

    if (isCartOpen) toggleCart();
    if (payModal) payModal.classList.remove('hidden');
}

function closePaymentModal() {
    const payModal = document.getElementById('payment-modal');
    const slipInput = document.getElementById('slip-file-input');
    if (payModal) payModal.classList.add('hidden');
    if (slipInput) slipInput.value = '';
}

async function submitPaymentWithSlip() {
    if (!currentPendingOrder) return;
    const btn = document.getElementById('confirm-payment-btn');
    if (btn && btn.disabled) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> กำลังบันทึกออเดอร์...';
    }

    try {
        const { data: orderData, error: orderError } = await supabaseClient
            .from('orders')
            .insert([{
                user_id: currentUser.id,
                user_email: currentUser.email,
                total_amount: currentPendingOrder.totalPrice,
                items: currentPendingOrder.items,
                status: 'ชำระเงินแล้ว',
                payment_method: 'PromptPay QR',
                slip_url: null
            }])
            .select();

        if (orderError) throw orderError;

        // ถ้ามีการใช้คูปองส่วนลด ให้อัปเดตสถานะคูปองใบนั้นเป็น "used: true" ในบัญชีลูกค้า
        if (currentPendingOrder.couponUsed) {
            const { data: { user: fullUser } } = await supabaseClient.auth.getUser();
            const userCoupons = fullUser?.user_metadata?.redeemed_coupons || [];
            const updatedCoupons = userCoupons.map(c =>
                c.code.toUpperCase() === currentPendingOrder.couponUsed.toUpperCase()
                    ? { ...c, used: true, usedAt: new Date().toISOString() }
                    : c
            );
            await supabaseClient.auth.updateUser({ data: { redeemed_coupons: updatedCoupons } });
        }

        const newOrderId = orderData[0]?.id || 'N/A';
        await sendDiscordOrderNotification(newOrderId, currentUser.email, currentPendingOrder.totalPrice, currentPendingOrder.items);

        cart = [];
        appliedCoupon = null;
        saveCartToStorage();
        saveCouponToStorage();
        updateCartUI();
        closePaymentModal();
        currentPendingOrder = null;

        showToast("ชำระเงินและบันทึกคำสั่งซื้อเรียบร้อยแล้ว!", "success");
    } catch (err) {
        console.error("Order submission error:", err);
        showToast("เกิดข้อผิดพลาดในการบันทึกออเดอร์: " + err.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane mr-2"></i> ยืนยันการชำระเงิน';
        }
    }
}

async function sendDiscordOrderNotification(orderId, userEmail, totalAmount, items) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL === "YOUR_DISCORD_WEBHOOK_URL_HERE") return;
    const itemListStr = items.map(i => `• **${i.name}** (x${i.quantity}) - ฿${(i.price * i.quantity).toLocaleString()}`).join('\n');

    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: "ElectroHub Bot",
                avatar_url: "https://cdn-icons-png.flaticon.com/512/891/891462.png",
                embeds: [{
                    title: `🛒 มีคำสั่งซื้อใหม่เข้ามา! (ออเดอร์ #${orderId})`,
                    color: 0x2563eb,
                    fields: [
                        { name: "👤 ผู้สั่งซื้อ", value: userEmail, inline: true },
                        { name: "💳 ช่องทางชำระเงิน", value: "PromptPay QR Code", inline: true },
                        { name: "💰 ยอดรวมสุทธิ", value: `**฿${totalAmount.toLocaleString()}**`, inline: false },
                        { name: "📦 รายการสินค้า", value: itemListStr || "ไม่มีข้อมูล", inline: false }
                    ],
                    footer: { text: "ElectroHub E-Commerce Notification System" },
                    timestamp: new Date().toISOString()
                }]
            })
        });
    } catch (err) {
        console.error("Discord Notification error:", err);
    }
}

// ==========================================
// 6. ระบบแจ้งเตือน Toast และซิงค์ตะกร้าอัตโนมัติ
// ==========================================
function showToast(message, type = "success") {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-enter flex items-center p-4 mb-2 text-gray-900 bg-white rounded-xl shadow-xl border-l-4 w-full sm:min-w-[300px] sm:w-auto`;

    if (type === "success") {
        toast.classList.add('border-green-500');
        toast.innerHTML = `<div class="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 text-green-500 bg-green-100 rounded-lg mr-3"><i class="fa-solid fa-check"></i></div><div class="text-sm font-medium">${message}</div>`;
    } else {
        toast.classList.add('border-red-500');
        toast.innerHTML = `<div class="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 text-red-500 bg-red-100 rounded-lg mr-3"><i class="fa-solid fa-exclamation"></i></div><div class="text-sm font-medium">${message}</div>`;
    }

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.replace('toast-enter', 'toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

window.addEventListener('pageshow', () => {
    cart = JSON.parse(localStorage.getItem('electrohub_cart')) || [];
    appliedCoupon = JSON.parse(localStorage.getItem('electrohub_coupon')) || null;
    updateCartUI();
});
