import {
  BarChart3,
  Inbox,
  Package,
  Radar,
  Sparkles,
  Users,
  type LucideIcon
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /** Module number from the spec (Phân hệ) — shown in the sidebar as a hint. */
  module: string;
  description: string;
  icon: LucideIcon;
  /** Rendered in the mobile bottom nav (kept to four thumb-reach slots). */
  mobilePrimary: boolean;
};

/**
 * Single nav definition consumed by the desktop sidebar, the mobile sheet and
 * the bottom tab bar. Adding a module here wires all three surfaces.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/queue",
    label: "Hàng đợi duyệt",
    module: "5–6",
    description: "Xem nháp AI, duyệt bài và kích hoạt worker",
    icon: Inbox,
    mobilePrimary: true
  },
  {
    href: "/radar",
    label: "Radar theo dõi",
    module: "3",
    description: "Nhóm Facebook, Fanpage và KOL đang quét",
    icon: Radar,
    mobilePrimary: false
  },
  {
    href: "/products",
    label: "Kho sản phẩm",
    module: "4",
    description: "Kho sản phẩm affiliate, ảnh review và hoa hồng",
    icon: Package,
    mobilePrimary: true
  },
  {
    href: "/accounts",
    label: "Dàn tài khoản",
    module: "1–2",
    description: "Quản lý nick Facebook, persona và trust score",
    icon: Users,
    mobilePrimary: true
  },
  {
    href: "/ai",
    label: "Trí tuệ nhân tạo (AI)",
    module: "5",
    description: "Cấu hình Gemini, prompt và kiểm thử sinh draft",
    icon: Sparkles,
    mobilePrimary: false
  },
  {
    href: "/analytics",
    label: "Phân tích & Doanh thu",
    module: "7",
    description: "Đối soát Sub_ID, đơn hàng và tỷ suất ROI",
    icon: BarChart3,
    mobilePrimary: true
  }
];

export const MOBILE_TABS = NAV_ITEMS.filter((item) => item.mobilePrimary);

export function findNavItem(pathname: string) {
  return NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
}
