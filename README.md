# MỘC CAFÉ — Website quản lý quán cà phê + Supabase

Gói source HTML/CSS/JavaScript thuần. Gồm trang **index.html** (dashboard), **login.html** và **register.html**. Hệ thống được thiết kế cho quán cà phê nhỏ, có quản lý đơn hàng, sản phẩm, khách hàng, báo cáo, ảnh món và cập nhật qua Supabase Realtime.

## 1. Cấu trúc file

```text
moc_cafe_supabase/
├── index.html                # Trang chủ / dashboard quản lý
├── login.html                # Đăng nhập + gửi email khôi phục mật khẩu
├── register.html             # Đăng ký + xác thực email
├── supabase-config.js        # ĐIỀN URL + PUBLISHABLE KEY TẠI ĐÂY
├── css/
│   ├── base.css
│   ├── auth.css
│   └── dashboard.css
├── js/
│   ├── auth.js
│   └── dashboard.js
├── assets/
│   ├── coffee-flatlay.png    # Ảnh người dùng cung cấp
│   └── coffee-cup.png        # Ảnh người dùng cung cấp
└── supabase/
    └── schema.sql            # CSDL, RPC, RLS, Storage, Realtime
```

## 2. Tạo và cấu hình Supabase

1. Vào https://supabase.com/dashboard và tạo project mới.
2. Mở **SQL Editor → New query**. Copy toàn bộ nội dung `supabase/schema.sql` vào SQL Editor rồi bấm **Run**. Script này tạo các bảng `profiles`, `products`, `customers`, `orders`, `order_items` và các hàm RPC để tạo/cập nhật đơn. Nó còn bật RLS, mở Storage bucket `cafe-products` và bật Postgres Changes cho Realtime.
3. Vào **Project Settings → API** (giao diện mới có thể hiển thị **API Keys**) lấy:
   - **Project URL** dạng `https://xxxxxxxx.supabase.co`
   - **Publishable key** dạng `sb_publishable_...` (hoặc **anon public key** đời cũ).
4. Mở `supabase-config.js`, thay 2 giá trị mẫu:

```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
```

**Không bao giờ** đưa `service_role`, `secret key` hoặc mật khẩu database vào JavaScript phía trình duyệt. Chỉ dùng publishable/anon key cùng RLS.

5. Trong **Authentication → Providers → Email**, bật email/password. Nếu bật **Confirm email** thì người dùng cần mở email để xác thực mới đăng nhập được (đề xuất bật).
6. Trong **Authentication → URL Configuration**, đặt:
   - **Site URL**: URL website sau khi deploy (ví dụ `http://127.0.0.1:5500` nếu chạy Live Server tại máy; URL thực tế có thể là `http://localhost:5500`).
   - **Redirect URLs**: thêm URL đăng nhập tương ứng (ví dụ `http://127.0.0.1:5500/login.html`, `http://localhost:5500/login.html`) và URL deploy của bạn (`https://domain-cua-ban/login.html`).
   - Nếu Live Server sử dụng cổng khác, sửa theo đúng cổng của bạn. Redirect URL cần khớp chính xác.
7. Email xác thực sẽ dẫn người dùng về `login.html`. Sau khi xác thực, mở trang login và đăng nhập.

**Email demo Supabase:** Gửi mail xác thực và reset bằng dịch vụ email mặc định có hạn mức / giới hạn đối tượng nhận; để dùng thực tế với nhiều khách, cấu hình SMTP riêng trong Supabase.

## 3. Chạy website

**VS Code**: cài extension **Live Server** → Open Folder `moc_cafe_supabase` → chuột phải `index.html` → **Open with Live Server**.

Hoặc chạy bằng Python:

```bash
cd moc_cafe_supabase
python -m http.server 5500
```

Mở http://localhost:5500/ (bạn có thể bắt đầu từ `register.html`). **Không** chạy trực tiếp bằng `file://` vì các luồng auth redirect và tương tác web có thể lỗi.

### Trước khi điền Supabase

`index.html` hiển thị dữ liệu thử nghiệm và trạng thái `Demo · lưu tại trình duyệt` ở góc trên. Thanh cảnh báo vàng cũ đã xóa. Bạn có thể **thêm/sửa/xóa món, quản lý khách và lập đơn demo**. Dữ liệu demo cùng giỏ hàng được lưu trong `localStorage` của trình duyệt hiện tại, **không đồng bộ lên Supabase**. Để sử dụng dữ liệu thực giữa thiết bị, cấu hình Supabase rồi đăng nhập.

### Sau khi đăng nhập

- **Tổng quan**: doanh thu đơn đã thanh toán (trừ đơn hủy), đơn hôm nay, đơn chưa thu, số sản phẩm; biểu đồ 7 ngày; đơn mới nhất.
- **Đơn hàng**: thêm nhiều món và số lượng, chọn khách, ghi chú, tiền mặt/chuyển khoản/thẻ (chỉ ghi nhận thủ công), thay đổi trạng thái và đánh dấu đã thanh toán. RPC tự tính tiền dựa trên giá trong database và lưu lịch sử giá bán trong `order_items`.
- **Sản phẩm (quản trị)**: thêm/sửa/xóa, bật/tắt kinh doanh, upload ảnh lên Supabase Storage (khi có kết nối), tạo menu mẫu. Mỗi thẻ món có nút **＋ Thêm vào giỏ**.
- **Giỏ hàng**: chọn nhiều món từ menu, tăng/giảm số lượng, xóa một dòng hoặc làm trống, chọn khách/phương thức thanh toán, nhập ghi chú, **Tạo đơn hàng**. Giỏ hàng lưu cục bộ theo tài khoản đăng nhập và không tạo giao dịch ngân hàng. Giá lúc tạo đơn thực tế được xác minh qua RPC phía máy chủ.
- **Khách hàng**: thêm/sửa/xóa, ghi chú, liên kết đơn.
- **Báo cáo**: doanh thu, giá trị đơn trung bình, món bán chạy, xuất CSV.
- **Realtime**: tự cập nhật danh sách và chỉ số khi sản phẩm/khách/đơn thay đổi trong Supabase, kể cả giữa nhiều tab của cùng tài khoản.

## 4. Quyền truy cập và an toàn dữ liệu

- Supabase Auth xử lý email/password, tạo session và reset password. Mật khẩu **không lưu** vào bảng riêng của ứng dụng hoặc `localStorage` thủ công.
- Mọi bảng ứng dụng đều bật **Row Level Security (RLS)**. Mỗi tài khoản có **workspace riêng**, chỉ đọc/chỉnh dữ liệu của chính tài khoản. Chưa có cơ chế nhiều nhân viên cùng dùng một quán.
- `cafe_create_order()` chạy một transaction PostgreSQL; không cho phép phía Client tự gửi giá bán/tổng tiền tùy ý. Các trạng thái được cập nhật qua RPC đã kiểm tra quyền sở hữu.
- Trạng thái `paid` là **ghi nhận đã thu tiền do người quản lý thực hiện**, không chứng minh giao dịch ngân hàng thành công.
- Không được hủy đơn đã thanh toán trong app này để tránh thất thoát báo cáo; khi cần hoàn tiền phải bổ sung quy trình hoàn/điều chỉnh doanh thu.
- Giá trị đơn bình quân hiện được tính trên các đơn không hủy, bất kể đã thu hay chưa; doanh thu dựa vào đơn đã thu.
- Phiên bản này tải tối đa 1.000 dòng mỗi danh sách bằng REST API, thích hợp MVP. Khi quán có dữ liệu lớn, nên nâng cấp phân trang và báo cáo bằng SQL views/RPC phía server.
- Ảnh món upload lên bucket **public** chỉ dành cho hình sản phẩm (không upload CCCD, hóa đơn chứa thông tin cá nhân). File ảnh cũ chưa tự xóa khỏi bucket khi thay ảnh/xóa sản phẩm; cần dọn dẹp nếu vận hành lâu dài.

## Nâng cấp v2 — 25/10/2026

- Bỏ **thanh màu vàng** chế độ xem trước trên dashboard (vẫn giữ trạng thái demo nhỏ phía trên để tránh nhầm với dữ liệu thực).
- Mở luồng **menu → thêm vào giỏ → giỏ hàng → tạo đơn**. Nút quản trị Sửa/Ẩn/Xóa món riêng bên dưới, Xóa có hộp xác nhận.
- Bản xem trước hỗ trợ thao tác CRUD và lưu tạm sản phẩm/khách/đơn/giỏ hàng qua localStorage. Ảnh demo có giới hạn 950 KB để tránh vượt quota lưu cục bộ.
- **Giới hạn phân quyền**: đây vẫn là một workspace riêng cho mỗi tài khoản, không có vai trò nhân viên/customer độc lập. Tài khoản sở hữu dữ liệu có thể CRUD. Nếu muốn admin chung quản lý nhiều tài khoản và khách đặt hàng online, cần thiết kế thêm phân quyền và chính sách Supabase ở backend.
- **Đơn hàng đã ghi nhận**: không hỗ trợ xóa lịch sử trực tiếp; chỉ cập nhật trạng thái và thanh toán qua hàm RPC nhằm giữ nhật ký doanh thu.
- Sử dụng `supabase/schema.sql` ban đầu, không cần chạy script thay đổi CSDL khi nâng cấp từ bản trước.

## 5. Thanh toán thật (nâng cấp sau)

Ứng dụng đã có trường `payment_method`, `payment_status`, `paid_at` và chỗ thao tác trên đơn, **chưa tích hợp các API ngân hàng, thẻ, ví điện tử**. Muốn triển khai VNPAY/MoMo/Stripe... cần triển khai server-side/Edge Function, xác minh chữ ký webhook thanh toán trước khi cập nhật `payment_status` — **không bao giờ tin dữ liệu trả về trực tiếp từ Client**.

## 6. Cần kiểm tra trước khi dùng thật

- Chạy SQL không lỗi.
- Đăng ký, kiểm tra email, đăng nhập, đăng xuất, quên mật khẩu.
- Tạo ít nhất 1 sản phẩm và 1 khách; tạo đơn 2 sản phẩm; kiểm tra tổng tiền khớp.
- Mở 2 tab cùng tài khoản, cập nhật đơn và kiểm tra realtime.
- Tạo tài khoản thứ hai và xác minh **không xem được** sản phẩm/đơn/khách của tài khoản thứ nhất.
- Thử đổi giá sản phẩm và xem giá của đơn cũ không đổi.
- Thử hủy đơn đã thanh toán và xác minh thao tác bị từ chối.

## Công nghệ

HTML5 / CSS3 / Vanilla JavaScript / Supabase JS v2 qua CDN / PostgreSQL / RLS / Realtime / Supabase Storage. Bộ ảnh trang chủ dùng 2 ảnh do người dùng cung cấp.

Tài liệu Supabase: https://supabase.com/docs/reference/javascript/initializing · https://supabase.com/docs/guides/auth/passwords · https://supabase.com/docs/guides/realtime/postgres-changes
