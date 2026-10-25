'use strict';
const sb = window.cafeSupabase;
const page = document.body.dataset.page;
const $ = id => document.getElementById(id);
const form = $(page === 'login' ? 'loginForm' : 'registerForm');
const submitBtn = $('submitBtn');
const statusEl = $('formMessage');
let recoveryMode = new URLSearchParams(location.hash.replace(/^#/, '')).get('type') === 'recovery' || new URLSearchParams(location.search).get('type') === 'recovery';

const showStatus = (text, isError = false) => {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = `form-message ${isError ? 'error' : 'success'}`;
};
const busy = (yes, caption) => {
  submitBtn.disabled = yes;
  submitBtn.textContent = yes ? 'Đang xử lý...' : caption;
};
const goToIndex = () => location.replace('./index.html');
if (!sb) {
  $('configNotice')?.classList.remove('hidden');
}

document.querySelectorAll('[data-reveal]').forEach(button => button.addEventListener('click', () => {
  const input = $(button.dataset.reveal);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  button.textContent = input.type === 'password' ? 'Hiện' : 'Ẩn';
}));

function showRecovery() {
  recoveryMode = true;
  $('loginPanel')?.classList.add('hidden');
  $('resetPanel')?.classList.remove('hidden');
}

if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    if (page === 'login' && event === 'PASSWORD_RECOVERY') showRecovery();
    if (!recoveryMode && session?.user && event === 'SIGNED_IN') goToIndex();
  });
  sb.auth.getSession().then(({ data }) => {
    if (data.session && !recoveryMode) goToIndex();
  }).catch(console.error);
}

if (page === 'login') {
  if (recoveryMode) showRecovery();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (!sb) { showStatus('Chưa kết nối Supabase. Hãy thiết lập cấu hình trước.', true); return; }
    busy(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
      if (error) throw error;
      showStatus('Đăng nhập thành công! Đang chuyển trang...');
      goToIndex();
    } catch (err) { showStatus(err.message || 'Đăng nhập thất bại.', true); }
    finally { busy(false, 'Đăng nhập ↗'); }
  });
  $('forgotBtn').addEventListener('click', async () => {
    if (!sb) { showStatus('Cần cấu hình Supabase trước.', true); return; }
    const email = $('email').value.trim();
    if (!email) { showStatus('Nhập email trước, sau đó bấm Quên mật khẩu.', true); $('email').focus(); return; }
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('./login.html', location.href).href });
      if (error) throw error;
      showStatus('Nếu email hợp lệ, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư của bạn.');
    } catch (err) { showStatus(err.message, true); }
  });
  $('resetForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!sb) return;
    const pass = $('newPassword').value;
    if (pass.length < 8) { $('resetMessage').textContent = 'Mật khẩu tối thiểu 8 ký tự.'; return; }
    const btn = e.currentTarget.querySelector('button[type=submit]');
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: pass });
    btn.disabled = false;
    if (error) { $('resetMessage').textContent = error.message; return; }
    $('resetMessage').textContent = 'Cập nhật thành công. Đang mở trang quản lý...';
    setTimeout(goToIndex, 700);
  });
} else {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (!sb) { showStatus('Chưa kết nối Supabase. Hãy thiết lập cấu hình trước.', true); return; }
    if ($('password').value !== $('confirmPassword').value) { showStatus('Hai mật khẩu chưa khớp.', true); return; }
    if (!$('agree').checked) { showStatus('Vui lòng xác nhận đồng ý.', true); return; }
    busy(true);
    try {
      const { data, error } = await sb.auth.signUp({
        email: $('email').value.trim(),
        password: $('password').value,
        options: {
          data: { full_name: $('fullName').value.trim() },
          emailRedirectTo: new URL('./login.html', location.href).href
        }
      });
      if (error) throw error;
      if (data.session) {
        showStatus('Tạo tài khoản thành công! Đang mở trang quản lý...');
        goToIndex();
      } else {
        showStatus('Yêu cầu đăng ký đã được tiếp nhận. Hãy kiểm tra email xác thực rồi đăng nhập. Nếu email đã tồn tại, hệ thống có thể không thông báo cụ thể.');
        form.reset();
      }
    } catch (err) { showStatus(err.message || 'Không thể tạo tài khoản.', true); }
    finally { busy(false, 'Tạo tài khoản ↗'); }
  });
}
