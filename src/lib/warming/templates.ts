import type { WarmingKind } from "@/lib/db-types";

/**
 * Warming content.
 *
 * Templates instead of an LLM call on purpose: warming runs on a schedule,
 * unattended, and must work with no GEMINI_API_KEY. They are short, ordinary
 * posts a person would actually write — no links, no hashtags, no sales voice —
 * because the whole point of warming is that the account looks like a person
 * rather than a billboard.
 *
 * `GEMINI_API_KEY` can later enrich these; the template is the floor, not the
 * ceiling.
 */

type PersonaTemplates = {
  lifestyle: string[];
  crossWarm: string[];
  /** Short, first-person intro — what a visitor reads under the avatar. */
  bio: string[];
};

const GENERIC: PersonaTemplates = {
  lifestyle: [
    "Cuối tuần ở nhà dọn dẹp, thấy nhẹ cả người.",
    "Hôm nay trời đẹp, làm ly cà phê rồi ngồi tính chuyện tuần sau.",
    "Đang tìm vài món cho nhà, ưu tiên loại dùng được lâu.",
    "Mới sắp xếp lại góc làm việc, gọn hơn hẳn."
  ],
  crossWarm: [
    "Nhìn gọn ghê, mình cũng đang tính làm một góc như vậy.",
    "Cái này nhà mình cũng dùng, thấy ổn trong tầm giá.",
    "Cho mình hỏi bạn mua ở đâu vậy?",
    "Ưng cách bạn sắp xếp, để mình thử xem sao."
  ],
  bio: [
    "Thích dọn dẹp, thích đồ dùng được lâu. Ghi lại mấy thứ hay hay trong ngày.",
    "Ở nhà nhiều, hay tìm mấy món tiện cho việc nhà.",
    "Chỉ là một người bình thường thích sắp xếp lại mọi thứ."
  ]
};

const BY_PERSONA: Record<string, PersonaTemplates> = {
  me_bim: {
    lifestyle: [
      "Bé nhà mình hôm nay ăn ngoan, mẹ rảnh được buổi chiều.",
      "Mấy hôm nay đổi giờ ngủ cho bé, cả nhà đỡ mệt hơn.",
      "Mẹ nào đang tập ăn dặm thì chuẩn bị tinh thần là bữa nào cũng như đánh trận nhé.",
      "Đồ cho bé mình ưu tiên rửa nhanh, sạch, đỡ phải ngồi cọ."
    ],
    crossWarm: [
      "Bé nhà mình cũng tầm đó tháng, công nhận giai đoạn này mệt thật.",
      "Mẹ thử xem mấy loại rửa nhanh ấy, đỡ cực hơn nhiều.",
      "Cho mình xin kinh nghiệm với, nhà mình cũng đang tìm.",
      "Nghe hợp lý đó, mình lưu lại để thử."
    ],
    bio: [
      "Mẹ hai bé, đang học cách sắp xếp mọi thứ gọn hơn.",
      "Chia sẻ chuyện nuôi con và mấy món dùng hằng ngày.",
      "Thích đồ tiện, thích buổi sáng yên tĩnh."
    ]
  },
  decor: {
    lifestyle: [
      "Dọn lại phòng khách, bỏ bớt đồ là thấy rộng ra ngay.",
      "Màu gỗ với màu trắng đúng là combo không bao giờ lỗi.",
      "Nhà nhỏ thì cứ đồ đa năng mà dùng, đỡ chật.",
      "Cuối tuần thay vài món nhỏ mà góc nhà khác hẳn."
    ],
    crossWarm: [
      "Phòng này nhìn thoáng ghê, bạn sắp xếp khéo thật.",
      "Mình cũng thích kiểu tối giản như vậy, để được nhiều đồ mà không rối.",
      "Cho mình hỏi cái kệ đó chịu được nặng không?",
      "Ưng quá, để mình tham khảo thêm."
    ],
    bio: [
      "Thích nhà gọn, đồ bền, và ánh sáng tự nhiên.",
      "Sửa sang từng góc nhỏ, mỗi tuần một chút.",
      "Đồ đa năng là lựa chọn đầu tiên của mình."
    ]
  },
  tech: {
    lifestyle: [
      "Dùng thử mấy món đồ công nghệ nhỏ, thấy mấy cái tiện lại hay dùng nhất.",
      "Pin với sạc nhanh giờ là tiêu chí đầu tiên mình xem khi mua đồ.",
      "Mua đồ công nghệ thì cứ xem kỹ bảo hành, đừng ham rẻ.",
      "Ngồi cả ngày với máy tính thì cái ghế quan trọng hơn cái máy."
    ],
    crossWarm: [
      "Con này thông số ổn trong tầm giá, dùng hằng ngày thoải mái.",
      "Mình cũng đang cân nhắc, nghe bạn nói thấy yên tâm hơn.",
      "Bạn dùng được lâu chưa? Mình quan tâm độ bền.",
      "Chuẩn, mình cũng ưu tiên bảo hành hơn giá."
    ],
    bio: [
      "Dùng thử đồ công nghệ rồi ghi lại cảm nhận thật.",
      "Thích món nhỏ, tiện, dùng hằng ngày.",
      "Ưu tiên bảo hành và độ bền hơn thông số."
    ]
  },
  gia_dung: {
    lifestyle: [
      "Mấy món nhỏ trong bếp dùng hằng ngày mới thấy đáng tiền.",
      "Gọn bếp lại một lần là nấu ăn cũng thấy dễ chịu hơn.",
      "Nhà mình ưu tiên đồ rửa nhanh, để được nhiều, không chiếm chỗ.",
      "Cuối tuần lau dọn, thay vài món cũ là bếp sáng hẳn."
    ],
    crossWarm: [
      "Món này nhà mình cũng dùng, khá tiện cho bếp nhỏ.",
      "Bạn cho mình hỏi dùng có ồn không?",
      "Để mình thử, đang cần loại gọn gàng như vậy.",
      "Nhìn thực tế đó, cảm ơn bạn chia sẻ."
    ],
    bio: [
      "Bếp nhỏ, đồ gọn, nấu nhanh là đủ.",
      "Ghi lại những món dùng hằng ngày thấy đáng tiền.",
      "Thích lau dọn và sắp xếp lại bếp."
    ]
  }
};

export function templatesFor(personaType: string): PersonaTemplates {
  return BY_PERSONA[personaType] ?? GENERIC;
}

export function contentFor(
  personaType: string,
  kind: WarmingKind,
  seedKey: string
): string {
  const templates = templatesFor(personaType);
  const pool =
    kind === "profile_setup"
      ? templates.bio
      : kind === "lifestyle_post"
        ? templates.lifestyle
        : templates.crossWarm;
  return pool[hash(seedKey) % pool.length] ?? pool[0] ?? "";
}

/**
 * Deterministic picker: the same (account, day, slot) always yields the same
 * text, so a retry after a network failure repeats the post instead of inventing
 * a new one.
 */
function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result);
}
