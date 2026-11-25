import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
  LockKeyholeIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon
} from "lucide-react";

import { CopyButton } from "@/components/patterns/copy-button";
import { ShopProfitCalculator } from "@/components/shop-profit/calculator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SHOP_PROFIT_TRIAL_PRICE_VND } from "@/lib/shop-profit/calc";

export const metadata: Metadata = {
  title: "Sheet tính lãi thực nhận sau phí sàn và hoàn đơn",
  description:
    "Máy tính lãi một đơn miễn phí và file Excel/Google Sheets nhập hàng loạt, đối soát tiền sàn trả. Không tự bịa phí sàn; bạn dùng đúng mức phí của mình.",
  robots: { index: true, follow: true }
};

const PRICE = `${SHOP_PROFIT_TRIAL_PRICE_VND.toLocaleString("vi-VN")}đ`;

const CONSENT_MESSAGE =
  "Mình muốn nhận bản đầy đủ “Sheet tính lãi thực nhận sau phí sàn và hoàn đơn” với giá dùng thử 249.000đ. Mình đồng ý nhận file .xlsx qua tin nhắn này và sẽ thanh toán theo hướng dẫn của operator.";

const INCLUDED = [
  {
    title: "Nhập hàng loạt",
    body: "300 dòng đơn hàng, mỗi dòng một đơn. Công thức tự tính doanh thu, phí, giá vốn và lãi.",
    icon: FileSpreadsheetIcon
  },
  {
    title: "Hoàn một phần / toàn bộ",
    body: "Nhập số lượng hoàn, tiền đã hoàn, ship hoàn, phí được hoàn và hàng hoàn hỏng.",
    icon: RotateCcwIcon
  },
  {
    title: "Đối soát tiền sàn trả",
    body: "So dự kiến với số tiền thực nhận trên sao kê. Trạng thái Khớp / Thiếu / Thừa theo từng đơn.",
    icon: ShieldCheckIcon
  },
  {
    title: "Mẫu tách khỏi số thật",
    body: "Sheet Mẫu riêng, không được cộng vào tổng hợp. Bạn không phải xoá dữ liệu minh hoạ trước khi dùng.",
    icon: SparklesIcon
  },
  {
    title: "Không bịa phí",
    body: "Không có % phí mặc định. Mọi mức phí do bạn chép từ Seller Center hoặc sao kê của chính bạn.",
    icon: LockKeyholeIcon
  },
  {
    title: "Excel & Google Sheets",
    body: "File .xlsx mở trực tiếp bằng Excel hoặc import vào Google Sheets, giữ nguyên công thức.",
    icon: CheckCircle2Icon
  }
];

const FAQ = [
  {
    question: "File có tự điền phí sàn Shopee/TikTok Shop không?",
    answer:
      "Không. Mỗi sàn, ngành hàng, shop và chương trình có mức phí khác nhau, nên file không đoán. Bạn chép đúng % phí và phí cố định từ Seller Center/sao kê vào các ô vàng."
  },
  {
    question: "Bản dùng thử miễn phí khác bản đầy đủ thế nào?",
    answer:
      "Bản miễn phí tính một đơn và có file .xlsx cùng công thức. Bản đầy đủ thêm nhập hàng loạt, hoàn đơn theo từng dòng, đối soát tiền sàn trả, tổng hợp và sheet Mẫu riêng."
  },
  {
    question: "Có hỗ trợ hoàn một phần không?",
    answer:
      "Có. Nhập số lượng hoàn nhỏ hơn số lượng đơn. File vẫn tính giá vốn cho phần giữ lại, trừ tiền đã hoàn và cho phép nhập phí sàn/thanh toán thực tế được hoàn."
  },
  {
    question: "Mua bản đầy đủ ở đâu?",
    answer:
      "Trang này không có checkout tự động. Bạn nhắn tin cho operator/nơi bạn thấy sản phẩm, xác nhận đồng ý nhận file và thanh toán theo hướng dẫn. Operator ghi nhận trong CRM rồi gửi file .xlsx trực tiếp cho bạn."
  },
  {
    question: "Tôi có cần đăng nhập để dùng máy tính miễn phí không?",
    answer:
      "Không. Máy tính trên trang này dùng được ngay. Bản đầy đủ được operator giao thủ công sau khi xác nhận thanh toán, nên không có file trả phí nào nằm ở đường dẫn công khai."
  }
];

export default function ShopProfitPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/shop-profit" className="flex items-center gap-2 font-semibold">
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
              <FileSpreadsheetIcon className="size-4" />
            </span>
            <span>Affiliate ERP</span>
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Sản phẩm số</Badge>
            <Button asChild size="sm" variant="outline">
              <a href="#may-tinh">Dùng thử miễn phí</a>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-14">
          <div className="space-y-6">
            <div className="space-y-3">
              <Badge variant="success" className="w-fit">
                Bản dùng thử miễn phí
              </Badge>
              <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
                Biết chính xác tiền thực nhận sau phí sàn và hoàn đơn
              </h1>
              <p className="text-muted-foreground max-w-2xl text-base leading-relaxed text-pretty sm:text-lg">
                Một file Excel/Google Sheets để tính lãi từng đơn, xử lý hoàn một phần hoặc toàn
                bộ, rồi đối soát số tiền sàn thực trả. Không có tỷ lệ phí nào bị đoán trước.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="min-h-11">
                <a href="/shop-profit/download">
                  <DownloadIcon />
                  Tải bản dùng thử .xlsx
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="min-h-11">
                <a href="#may-tinh">
                  Tính thử 1 đơn
                  <ArrowRightIcon />
                </a>
              </Button>
            </div>

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["1 đơn", "miễn phí trên web"],
                ["300 đơn", "trong bản đầy đủ"],
                ["0", "tỷ lệ phí tự đoán"],
                ["1 file", "Excel & Google Sheets"]
              ].map(([value, label]) => (
                <div key={label} className="rounded-lg border bg-card p-3">
                  <dt className="font-mono text-lg font-semibold tabular-nums">{value}</dt>
                  <dd className="text-muted-foreground mt-0.5 text-xs leading-snug">{label}</dd>
                </div>
              ))}
            </dl>

            <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm leading-relaxed">
              <p className="font-medium">Điểm quan trọng</p>
              <p className="text-muted-foreground mt-1">
                File không cài sẵn phí Shopee, TikTok Shop, Lazada hay bất kỳ sàn nào. Mức phí thay
                đổi theo ngành hàng, shop và chương trình; bạn chép đúng con số từ Seller
                Center/sao kê. Để trống hoặc 0 nghĩa là “chưa nhập”, không phải phí thật.
              </p>
            </div>
          </div>

          <Card className="h-fit lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle>Bản đầy đủ</CardTitle>
              <CardDescription>
                Dành cho shop có nhiều đơn và cần đối soát tiền sàn trả.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-2">
                <span className="font-mono text-4xl font-semibold tracking-tight tabular-nums">
                  {PRICE}
                </span>
                <span className="text-muted-foreground pb-1 text-sm">giá dùng thử</span>
              </div>
              <ul className="space-y-2 text-sm">
                {[
                  "Nhập hàng loạt 300 đơn",
                  "Hoàn một phần / toàn bộ",
                  "Đối soát thực nhận từng đơn",
                  "Tổng hợp lãi & biên lãi",
                  "Sheet Mẫu riêng, không lẫn số thật",
                  "Không khoá công thức, dùng lại nhiều lần"
                ].map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2Icon className="text-success mt-0.5 size-4 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className="min-h-11 w-full">
                <a href="#cach-nhan">
                  Xem cách nhận bản đầy đủ
                  <ArrowRightIcon />
                </a>
              </Button>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Thanh toán và giao file thủ công qua operator. Trang này không có checkout tự động
                và không thu thập thông tin thẻ.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="may-tinh" className="scroll-mt-6 border-y bg-muted/20">
          <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
            <div className="mb-5 max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-tight">Tính thử một đơn ngay</h2>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                Đây là công cụ miễn phí, không cần đăng nhập. Kết quả cập nhật ngay khi bạn nhập.
                Cùng công thức này nằm trong file .xlsx tải về.
              </p>
            </div>
            <ShopProfitCalculator />
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="mb-6 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight">Bản đầy đủ có gì</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              File .xlsx thật, không phải ảnh mẫu. Mở bằng Excel hoặc import vào Google Sheets.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {INCLUDED.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.title}>
                  <CardHeader>
                    <span className="bg-muted flex size-9 items-center justify-center rounded-md">
                      <Icon className="size-4" />
                    </span>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <CardDescription className="leading-relaxed">{item.body}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </section>

        <section id="cach-nhan" className="scroll-mt-6 border-y bg-muted/20">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_0.8fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Cách nhận bản đầy đủ</h2>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                Quy trình thủ công, có xác nhận thanh toán và đồng ý nhận file. Không có nút mua
                giả lập.
              </p>
              <ol className="mt-5 space-y-4">
                {[
                  {
                    title: "Nhắn tin cho operator/nơi bạn thấy sản phẩm",
                    body: "Nói rõ bạn muốn bản đầy đủ và đồng ý nhận file .xlsx qua tin nhắn. Bạn có thể dùng tin nhắn mẫu bên cạnh."
                  },
                  {
                    title: "Operator xác nhận thanh toán",
                    body: `Operator hướng dẫn thanh toán ${PRICE} và xác nhận đã nhận tiền. Không có cổng thanh toán tự động trên trang này.`
                  },
                  {
                    title: "Operator ghi nhận đồng ý trong CRM",
                    body: "Lead được đánh dấu đã mua template và ghi nhận đồng ý giao file. Đây là bước bắt buộc trước khi file được gửi."
                  },
                  {
                    title: "Nhận file riêng",
                    body: "Operator gửi file .xlsx trực tiếp qua kênh hai bên đã trao đổi. Bản trả phí không nằm ở đường dẫn công khai."
                  }
                ].map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold">
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-medium">{step.title}</p>
                      <p className="text-muted-foreground mt-0.5 text-sm leading-relaxed">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-base">Tin nhắn mẫu</CardTitle>
                <CardDescription>
                  Sao chép rồi gửi cho operator. Việc gửi tin nhắn là bạn chủ động đồng ý nhận
                  file.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="bg-muted/60 rounded-lg border p-3 font-sans text-sm leading-relaxed whitespace-pre-wrap">
                  {CONSENT_MESSAGE}
                </pre>
                <CopyButton
                  value={CONSENT_MESSAGE}
                  label="Sao chép tin nhắn"
                  size="lg"
                  variant="outline"
                  className="min-h-11 w-full"
                />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Không có email, số điện thoại hay link thanh toán giả lập trong file/trang này.
                  Nếu bạn không rõ nơi nhận sản phẩm, hãy quay lại bài đăng/nhóm mà bạn thấy sản
                  phẩm.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Câu hỏi thường gặp</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {FAQ.map((item) => (
              <details key={item.question} className="group rounded-xl border bg-card p-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium">
                  {item.question}
                  <span className="text-muted-foreground transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="border-t bg-muted/20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Bắt đầu bằng bản miễn phí
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Tải file tính 1 đơn, hoặc dùng máy tính ngay trên trang.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild size="lg" className="min-h-11">
                <a href="/shop-profit/download">
                  <DownloadIcon />
                  Tải bản dùng thử
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="min-h-11">
                <a href="#may-tinh">Mở máy tính</a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs sm:px-6 md:flex-row md:items-center md:justify-between">
          <p>Affiliate ERP · Sheet tính lãi thực nhận sau phí sàn và hoàn đơn</p>
          <p>
            Công cụ tính toán, không phải phần mềm kế toán/thuế. Kiểm tra chính sách sàn và quy
            định thuế hiện hành.
          </p>
        </div>
      </footer>
    </div>
  );
}
