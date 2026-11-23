// This workspace belongs to one operator in Phase 1; never accept the owner from an ingest payload.
export const LEAD_OWNER_ID = "default_owner";

export const DEFAULT_LEAD_KEYWORDS = [
  "file excel", "google sheet", "tính lãi lỗ", "phí sàn", "đối soát", "quản lý kho",
  "công nợ", "báo cáo doanh thu", "file quản lý", "quản lý dòng tiền",
  "tự động", "gửi về zalo", "báo đơn telegram", "apps script", "n8n", "make.com",
  "gom đơn", "đồng bộ đơn", "thuê làm tool", "cần người code", "cào dữ liệu"
] as const;
