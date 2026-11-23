// Synthetic posts and model completions for the offline CLI; none are sent to Facebook or an LLM.
export const leadExamples = [
  {
    text: "Mình cần thuê làm tool đối soát phí sàn tuần này. Có ai nhận làm cho shop không?",
    classification: {
      intent_type: "buyer_inquiry", score: 5, matched_category: "automation",
      summary: "Chủ shop cần thuê người làm công cụ đối soát phí sàn trong tuần.",
      suggested_comment: "Bạn có thể bắt đầu bằng cách ghép mã đơn ở báo cáo bán hàng và sao kê. Nếu tiện, mình gửi mẫu đối soát để bạn thử trước nhé.",
      suggested_dm: "Mình gửi bạn mẫu đối soát như đã hẹn nhé. Bạn đang lấy báo cáo từ sàn nào?"
    }
  },
  {
    text: "Shop mình đang dùng file Excel để tính lãi lỗ, nhưng tháng nào cũng lệch phí hoàn đơn. Mọi người đối soát mục này thế nào?",
    classification: {
      intent_type: "help_needed", score: 4, matched_category: "sheets_excel",
      summary: "Shop cần tách phí hoàn đơn để tính đúng lãi lỗ cuối tháng.",
      suggested_comment: "Bạn thử tách phí hoàn đơn thành cột riêng và ghi theo ngày sàn hạch toán nhé. Mình có mẫu bảng nhỏ, bạn muốn thì mình gửi qua inbox.",
      suggested_dm: "Mình gửi bạn mẫu theo dõi phí hoàn đơn nhé. Hiện bạn chốt lãi theo ngày giao hay ngày nhận tiền?"
    }
  },
  {
    text: "Mở bán khóa học Google Sheet cho chủ shop, đăng ký hôm nay để nhận ưu đãi!",
    classification: {
      intent_type: "seller_promo", score: 2, matched_category: "sheets_excel",
      summary: "Tác giả đang quảng bá khóa học, không hỏi mua hay nhờ hỗ trợ.",
      suggested_comment: "Đây là bài quảng cáo khóa học. Không cần bình luận.",
      suggested_dm: "Không cần nhắn tin cho bài quảng cáo này."
    }
  }
];
