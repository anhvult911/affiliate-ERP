import type { XlsxRow, XlsxSheet } from "@/lib/shop-profit/xlsx";
import { SHEET_STYLE } from "@/lib/shop-profit/styles";

const S = SHEET_STYLE;

type InputRow = {
  label: string;
  value: string | number;
  style: number;
  note: string;
};

const INPUT_ROWS: readonly InputRow[] = [
  {
    label: "Mã đơn / tên đơn",
    value: "",
    style: S.inputText,
    note: "Ví dụ: SP001. Chỉ để bạn nhận diện đơn; không bắt buộc với công thức."
  },
  {
    label: "Số lượng",
    value: 1,
    style: S.inputInt,
    note: "Số sản phẩm khách đặt."
  },
  {
    label: "Giá bán 1 sản phẩm",
    value: 0,
    style: S.inputMoney,
    note: "Giá khách trả cho 1 sản phẩm, trước giảm giá shop."
  },
  {
    label: "Giá vốn 1 sản phẩm",
    value: 0,
    style: S.inputMoney,
    note: "Giá nhập + chi phí trực tiếp của 1 sản phẩm."
  },
  {
    label: "Ship khách trả",
    value: 0,
    style: S.inputMoney,
    note: "Số tiền ship khách trả cho đơn này."
  },
  {
    label: "Ship shop trả (chiều đi)",
    value: 0,
    style: S.inputMoney,
    note: "Số tiền shop trả cho đơn vị vận chuyển/sàn."
  },
  {
    label: "Giảm giá shop tài trợ",
    value: 0,
    style: S.inputMoney,
    note: "Mã giảm giá/voucher do shop chịu. Không nhập voucher sàn tài trợ."
  },
  {
    label: "Phí sàn (%)",
    value: 0,
    style: S.inputPercent,
    note: "Chép đúng % phí sàn trên Seller Center. KHÔNG có mức mặc định trong file."
  },
  {
    label: "Phí sàn cố định",
    value: 0,
    style: S.inputMoney,
    note: "Phí cố định theo đơn (nếu có). Để 0 nếu không có."
  },
  {
    label: "Phí thanh toán (%)",
    value: 0,
    style: S.inputPercent,
    note: "Chép đúng % phí thanh toán/cổng thanh toán. Không tự đoán."
  },
  {
    label: "Phí thanh toán cố định",
    value: 0,
    style: S.inputMoney,
    note: "Phí cố định theo đơn (nếu có)."
  },
  {
    label: "Hoa hồng affiliate (%)",
    value: 0,
    style: S.inputPercent,
    note: "Chỉ nhập nếu đơn có hoa hồng affiliate."
  },
  {
    label: "Số lượng hoàn",
    value: 0,
    style: S.inputInt,
    note: "0 = không hoàn. Hoàn một phần: nhập số lượng thực tế."
  },
  {
    label: "Hoàn tiền cho khách",
    value: 0,
    style: S.inputMoney,
    note: "Tổng tiền đã hoàn cho khách, gồm cả phần ship hoàn nếu có."
  },
  {
    label: "Ship hoàn shop trả",
    value: 0,
    style: S.inputMoney,
    note: "Chi phí vận chuyển chiều hoàn do shop chịu."
  },
  {
    label: "Phí sàn được hoàn",
    value: 0,
    style: S.inputMoney,
    note: "Chỉ nhập số tiền sàn thực tế đã hoàn lại. Không tự giả định."
  },
  {
    label: "Phí thanh toán được hoàn",
    value: 0,
    style: S.inputMoney,
    note: "Chỉ nhập số tiền cổng thanh toán thực tế đã hoàn."
  },
  {
    label: "Giá vốn hàng hoàn hỏng",
    value: 0,
    style: S.inputMoney,
    note: "Giá vốn của hàng hoàn không bán lại được. Để 0 nếu còn bán được."
  },
  {
    label: "Đóng gói",
    value: 0,
    style: S.inputMoney,
    note: "Túi, hộp, băng keo, nhãn… cho đơn này."
  },
  {
    label: "Quảng cáo phân bổ",
    value: 0,
    style: S.inputMoney,
    note: "Phần chi phí quảng cáo bạn muốn phân bổ cho đơn này."
  },
  {
    label: "Chi phí khác",
    value: 0,
    style: S.inputMoney,
    note: "Phí lấy hàng, lưu kho, nhân công… nếu muốn tính."
  }
] as const;

const RESULT_ROWS: readonly {
  label: string;
  formula: string;
  style: number;
  note: string;
}[] = [
  {
    label: "Doanh thu gộp",
    formula: "B7*B6+B9",
    style: S.resultMoney,
    note: "Giá bán × số lượng + ship khách trả."
  },
  {
    label: "Doanh thu thuần",
    formula: "B28-B11-B18",
    style: S.resultMoney,
    note: "Doanh thu gộp − giảm giá shop − hoàn tiền."
  },
  {
    label: "Cơ sở tính phí",
    formula: "MAX(0,B28-B11-B18)",
    style: S.resultMoney,
    note: "Phần doanh thu còn lại dùng để tính phí sàn/thanh toán/affiliate."
  },
  {
    label: "Phí sàn",
    formula: "MAX(0,B30*B12/100+B13-B20)",
    style: S.resultMoney,
    note: "Cơ sở phí × % phí sàn + phí cố định − phí sàn được hoàn."
  },
  {
    label: "Phí thanh toán",
    formula: "MAX(0,B30*B14/100+B15-B21)",
    style: S.resultMoney,
    note: "Cơ sở phí × % phí thanh toán + phí cố định − phí được hoàn."
  },
  {
    label: "Hoa hồng affiliate",
    formula: "MAX(0,B30*B16/100)",
    style: S.resultMoney,
    note: "Cơ sở phí × % hoa hồng affiliate."
  },
  {
    label: "Dự kiến sàn trả shop",
    formula: "B29-B31-B32-B33-B10-B19",
    style: S.resultMoney,
    note: "Doanh thu thuần − các loại phí − ship shop trả − ship hoàn."
  },
  {
    label: "Giá vốn còn lại",
    formula: "B8*MAX(0,B6-B17)+B22",
    style: S.resultMoney,
    note: "Giá vốn × (số lượng − số hoàn) + giá vốn hàng hoàn hỏng."
  },
  {
    label: "Tổng chi phí",
    formula: "B35+B23+B24+B25",
    style: S.resultMoney,
    note: "Giá vốn còn lại + đóng gói + quảng cáo + chi phí khác."
  },
  {
    label: "LÃI THỰC NHẬN",
    formula: "B34-B36",
    style: S.resultMoney,
    note: "Dự kiến sàn trả shop − tổng chi phí."
  },
  {
    label: "Biên lãi trên doanh thu gộp",
    formula: "IF(B28=0,0,B37/B28)",
    style: S.resultPercent,
    note: "Lãi ÷ doanh thu gộp."
  },
  {
    label: "ROI trên tổng chi phí",
    formula: "IF(B36=0,0,B37/B36)",
    style: S.resultPercent,
    note: "Lãi ÷ tổng chi phí."
  }
] as const;

/**
 * The free single-order calculator sheet. Also embedded by the private full
 * workbook generator, so the browser calculator, the free sheet and the paid
 * file all use the same formula.
 */
export function createCalculatorSheet(): XlsxSheet {
  const rows: XlsxRow[] = [
    {
      cells: [{ value: "TÍNH LÃI THỰC NHẬN CHO 1 ĐƠN", style: S.title }],
      height: 28
    },
    {
      cells: [
        {
          value:
            "Ô vàng là nơi nhập. Mọi tỷ lệ phí do bạn tự chép từ Seller Center/sao kê — file không tự đoán bất kỳ mức phí nào.",
          style: S.note
        }
      ],
      height: 32
    },
    { cells: [] },
    {
      cells: [
        { value: "Khoản mục", style: S.headerLeft },
        { value: "Giá trị", style: S.header },
        { value: "Cách nhập / lưu ý", style: S.headerLeft }
      ],
      height: 24
    }
  ];

  for (const input of INPUT_ROWS) {
    rows.push({
      cells: [
        { value: input.label, style: S.label },
        { value: input.value, style: input.style },
        { value: input.note, style: S.textWrap }
      ],
      height: 30
    });
  }

  rows.push({ cells: [] });
  rows.push({
    cells: [{ value: "KẾT QUẢ (tự động)", style: S.section }],
    height: 24
  });

  for (const result of RESULT_ROWS) {
    rows.push({
      cells: [
        { value: result.label, style: S.totalLabel },
        { formula: result.formula, style: result.style },
        { value: result.note, style: S.note }
      ],
      height: 28
    });
  }

  rows.push({
    cells: [
      {
        value:
          "Lưu ý: kết quả là ước tính theo đúng số bạn nhập. Chính sách phí, hoàn tiền và thuế của từng sàn có thể thay đổi; hãy đối chiếu sao kê thực tế.",
        style: S.note
      }
    ],
    height: 34
  });

  return {
    name: "Tính lãi 1 đơn",
    rows,
    columnWidths: [38, 18, 76],
    freezeRows: 4,
    merges: ["A1:C1", "A2:C2", "A27:C27"]
  };
}
