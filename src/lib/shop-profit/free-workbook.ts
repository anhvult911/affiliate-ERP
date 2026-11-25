import { Buffer } from "node:buffer";

import { createCalculatorSheet } from "@/lib/shop-profit/calculator-sheet";
import { SHOP_PROFIT_NAME, SHOP_PROFIT_TRIAL_PRICE_VND, SHOP_PROFIT_VERSION } from "@/lib/shop-profit/calc";
import { SHEET_STYLE } from "@/lib/shop-profit/styles";
import { buildXlsx, type XlsxRow, type XlsxSheet } from "@/lib/shop-profit/xlsx";

const S = SHEET_STYLE;

function instructionRows(): XlsxRow[] {
  const rows: XlsxRow[] = [];

  const add = (text: string, style: number = S.instruction, height?: number) => {
    const estimatedHeight = height ?? Math.max(22, Math.ceil(text.length / 95) * 20);
    rows.push({ cells: [{ value: text, style }], height: estimatedHeight });
  };

  add("SHEET TÍNH LÃI THỰC NHẬN SAU PHÍ SÀN VÀ HOÀN ĐƠN", S.title, 30);
  add(`Bản dùng thử miễn phí · Phiên bản ${SHOP_PROFIT_VERSION} · Bản đầy đủ: ${SHOP_PROFIT_TRIAL_PRICE_VND.toLocaleString("vi-VN")}đ`, S.section, 24);
  add("");
  add("1. BẢN NÀY CÓ GÌ", S.section, 24);
  add("• Máy tính lãi cho MỘT đơn hàng, có hỗ trợ hoàn một phần hoặc toàn bộ.");
  add("• Dùng được trên Excel và Google Sheets.");
  add("• Không có tỷ lệ phí nào được cài sẵn: bạn chép đúng mức phí của mình từ Seller Center/sao kê.");
  add("");
  add("2. BẢN ĐẦY ĐỦ CÓ GÌ", S.section, 24);
  add(`• Nhập hàng loạt tới 300 đơn trong một sheet.`);
  add("• Đối soát từng đơn: dự kiến sàn trả so với số tiền thực nhận trên sao kê.");
  add("• Tổng hợp lãi, biên lãi, đơn có hoàn, chênh lệch đối soát.");
  add("• Sheet Mẫu riêng, không được cộng vào tổng số thật.");
  add(`• Giá dùng thử: ${SHOP_PROFIT_TRIAL_PRICE_VND.toLocaleString("vi-VN")}đ cho bản đầy đủ.`);
  add("• Cách nhận: nhắn tin cho operator/nơi bạn thấy sản phẩm, nói rõ bạn muốn bản đầy đủ và đồng ý nhận file qua tin nhắn. Operator xác nhận thanh toán rồi giao file. Trang sản phẩm không có checkout tự động.");
  add("");
  add("3. MỞ FILE ĐÚNG CÁCH", S.section, 24);
  add("• Excel: mở trực tiếp file .xlsx. Nếu Excel hỏi, bấm Enable Editing.");
  add("• Google Sheets: tạo bảng tính mới → File → Import → Upload → chọn file → Import data → Replace spreadsheet.");
  add("• Không đổi tên sheet “Tính lãi 1 đơn” nếu bạn không muốn sửa công thức.");
  add("");
  add("4. CÁCH NHẬP", S.section, 24);
  add("• Chỉ nhập vào các ô vàng ở cột B của sheet “Tính lãi 1 đơn”.");
  add("• Bỏ trống/để 0 nghĩa là “chưa có khoản này”, không phải mức phí thật.");
  add("• Phí sàn (%) và phí thanh toán (%): chép đúng con số trên Seller Center. Mỗi sàn/ngành hàng/shop có thể khác nhau.");
  add("• Hoàn một phần: nhập số lượng hoàn nhỏ hơn số lượng đơn, rồi nhập tiền đã hoàn.");
  add("• Hoàn toàn bộ: số lượng hoàn = số lượng đơn.");
  add("• Nếu sàn hoàn lại phí, chỉ nhập số tiền thực tế đã hoàn. File không tự giả định sàn hoàn phí.");
  add("");
  add("5. CÔNG THỨC ĐANG DÙNG", S.section, 24);
  add("• Doanh thu gộp = Số lượng × Giá bán + Ship khách trả.");
  add("• Doanh thu thuần = Doanh thu gộp − Giảm giá shop − Hoàn tiền.");
  add("• Cơ sở phí = max(0, Doanh thu gộp − Giảm giá shop − Hoàn tiền).");
  add("• Phí sàn = max(0, Cơ sở phí × % phí sàn + phí cố định − phí sàn được hoàn).");
  add("• Phí thanh toán = max(0, Cơ sở phí × % phí thanh toán + phí cố định − phí thanh toán được hoàn).");
  add("• Hoa hồng affiliate = max(0, Cơ sở phí × % hoa hồng).");
  add("• Dự kiến sàn trả shop = Doanh thu thuần − phí sàn − phí thanh toán − hoa hồng − ship shop trả − ship hoàn.");
  add("• Giá vốn còn lại = Giá vốn 1 SP × (Số lượng − Số hoàn) + Giá vốn hàng hoàn hỏng.");
  add("• Lãi thực nhận = Dự kiến sàn trả shop − giá vốn còn lại − đóng gói − quảng cáo − chi phí khác.");
  add("");
  add("6. LƯU Ý", S.section, 24);
  add("• Đây là công cụ tính toán, không phải phần mềm kế toán/thuế. Hãy kiểm tra chính sách sàn và quy định thuế hiện hành.");
  add("• Không có kết nối tự động tới sàn; không có tỷ lệ phí nào được file tự điền.");
  add("• Không gửi file có dữ liệu đơn thật cho người khác nếu chưa ẩn thông tin khách.");
  add("• Cần bản đầy đủ? Nhắn operator/nơi bạn nhận file này. Không có email/tổng đài giả lập trong file.");
  add("");
  add(`${SHOP_PROFIT_NAME} · Bản dùng thử miễn phí`, S.note, 22);

  return rows;
}

/** Public free download: instructions + single-order calculator only. */
export function buildFreeWorkbook(): Buffer {
  const sheets: XlsxSheet[] = [
    {
      name: "Hướng dẫn",
      rows: instructionRows(),
      columnWidths: [120]
    },
    createCalculatorSheet()
  ];

  return buildXlsx(sheets, {
    title: `${SHOP_PROFIT_NAME} — bản dùng thử`,
    creator: "Affiliate ERP",
    createdAt: new Date(2026, 10, 23)
  });
}
