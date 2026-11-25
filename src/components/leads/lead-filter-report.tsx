import { createSupabaseServerClient } from "@/lib/supabase/server";

const labels: Record<string, string> = {
  empty: "Không có nội dung", too_short: "Quá ngắn", no_keyword: "Không khớp từ khóa",
  duplicate: "Đã ghi nhận", status_changed: "Đã được xử lý trong lúc phân loại",
  pending_review: "Chờ xem lại", storage_error: "Lỗi lưu dữ liệu", classified: "Đã phân loại, không gửi cảnh báo", alerted: "Đã gửi cảnh báo"
};

export async function LeadFilterReport() {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("lead_capture_report");
  return <details className="rounded-lg border p-4">
    <summary className="cursor-pointer font-medium">Kết quả lọc bài theo nhóm · 14 ngày</summary>
    <p className="my-3 text-sm text-muted-foreground">Đếm lượt xử lý trong 14 ngày lịch Việt Nam, không phải số người hay bài viết duy nhất. Không lưu nội dung bài bị loại.</p>
    {error ? <p role="alert">Không đọc được số liệu lọc.</p> : !data?.length ? <p>Chưa có lượt xử lý của nguồn Leads trong kỳ.</p> :
      <table className="w-full text-left text-sm"><thead><tr><th>Nhóm</th><th>Kết quả</th><th className="text-right">Lượt</th></tr></thead>
        <tbody>{data.map(row => <tr className="border-t" key={`${row.source_id}:${row.outcome}`}><td className="py-2">{row.group_name}</td><td>{labels[row.outcome] ?? row.outcome}</td><td className="text-right tabular-nums">{row.attempts}</td></tr>)}</tbody>
      </table>}
  </details>;
}
