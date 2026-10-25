import type { Metadata } from "next";

import { DraftPlayground } from "@/components/ai/draft-playground";
import { EngineStatus } from "@/components/ai/engine-status";
import { PromptPreview } from "@/components/ai/prompt-preview";
import { SourceContextTable } from "@/components/ai/source-context-table";
import { PageHeader } from "@/components/patterns/page-header";
import { isGeminiConfigured, readEmbeddingModel, readGeminiModel } from "@/lib/ai/gemini";
import {
  DRAFT_PROMPT_VERSION,
  MATCH_PROMPT_VERSION,
  buildDraftPrompt,
  buildMatchPrompt,
  readMatchThreshold,
  type DraftPersonaContext,
  type DraftProductContext,
  type DraftSourceContext,
  type MatchCandidate
} from "@/lib/ai/prompts";
import {
  getMatchCandidates,
  getPendingDraftTasks,
  getPromptExample,
  getSourceContexts,
  type AiPromptExample
} from "@/lib/data/ai-context";

export const metadata: Metadata = { title: "Trí tuệ nhân tạo (AI)" };

const EXAMPLE_POST_CONTENT =
  "Mới chuyển về căn hộ 45m², đang tìm mấy món decor nhỏ gọn mà giá hợp lý. " +
  "Có ai dùng đèn ngủ cảm ứng loại nhỏ chưa, review giúp mình với ạ?";

const EXAMPLE_PRODUCT: DraftProductContext = {
  name: "Đèn ngủ cảm ứng mini để bàn",
  niche: "decor",
  pros_cons_summary:
    "Ưu điểm: nhỏ gọn, sạc USB tiện đặt cạnh giường, cảm ứng nhạy. " +
    "Nhược điểm: pin chỉ dùng được khoảng 3 đêm mỗi lần sạc, ánh sáng không đủ để đọc sách."
};

const EXAMPLE_SOURCE: DraftSourceContext = {
  name: "Hội nghiện decor nhà cửa",
  niche: "decor",
  tone_of_voice: "Thân thiện, chia sẻ thật lòng, hay dùng 'mình' và 'mọi người'.",
  group_rules:
    "Không spam link, không quảng cáo trắng trợn. Phải trả lời đúng câu hỏi của thành viên."
};

const EXAMPLE_PERSONA: DraftPersonaContext = {
  name: "Mai",
  persona_type: "decor"
};

const EXAMPLE_MATCH_CANDIDATES: MatchCandidate[] = [
  {
    id: "example-decor-light",
    name: "Đèn ngủ cảm ứng mini để bàn",
    niche: "decor",
    pros_cons_summary: EXAMPLE_PRODUCT.pros_cons_summary
  },
  {
    id: "example-storage-box",
    name: "Hộp đựng đồ vải gấp gọn",
    niche: "decor",
    pros_cons_summary:
      "Ưu điểm: gấp gọn khi không dùng, vải dày. Nhược điểm: khung hơi mềm nên không chịu được đồ nặng."
  }
];

function buildPromptPreview(example: AiPromptExample | null, products: MatchCandidate[]) {
  const exampleProduct = example?.product ?? null;

  const candidates: MatchCandidate[] = exampleProduct
    ? [
        exampleProduct,
        ...products.filter((product) => product.id !== exampleProduct.id)
      ].slice(0, 6)
    : products.length > 0
      ? products.slice(0, 6)
      : EXAMPLE_MATCH_CANDIDATES;

  const rawPostContent = example?.postContent ?? "";
  const postContent = rawPostContent.trim().length > 0 ? rawPostContent : EXAMPLE_POST_CONTENT;
  const postImages = example?.postImages ?? [];

  const match = buildMatchPrompt({ postContent, postImages, candidates });
  const draft = buildDraftPrompt({
    post: { content: postContent, images: postImages, url: example?.postUrl ?? null },
    product: exampleProduct ?? EXAMPLE_PRODUCT,
    source: example?.source ?? EXAMPLE_SOURCE,
    persona: example
      ? example.account ?? { name: "Community member", persona_type: "ordinary shopper" }
      : EXAMPLE_PERSONA,
    mode: example?.executionMode ?? "single"
  });

  return { match, draft };
}

export default async function AiEnginePage() {
  const [sources, example, products, pendingTasks] = await Promise.all([
    getSourceContexts(),
    getPromptExample(),
    getMatchCandidates(),
    getPendingDraftTasks()
  ]);

  const configured = isGeminiConfigured();
  const threshold = readMatchThreshold();
  const { match, draft } = buildPromptPreview(example, products);

  const origin = example
    ? `Built from the newest pending task (${example.taskId.slice(0, 8)}…) — ` +
      `${example.product.name} matched to ${example.source.name}.`
    : "No pending task has a matched product and source yet, so the preview below is a synthetic " +
      "placeholder — not a production post. Prompts become auditable against live data as soon as " +
      "the radar enqueues its first match.";

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Trí tuệ nhân tạo (AI Engine)"
        description="Kiểm tra prompt Gemini nhận được, xem ngữ cảnh nguồn hội nhóm và thử nghiệm sinh bình luận trực tiếp."
      />

      <EngineStatus
        configured={configured}
        model={readGeminiModel()}
        embeddingModel={readEmbeddingModel()}
        threshold={threshold}
        matchPromptVersion={MATCH_PROMPT_VERSION}
        draftPromptVersion={DRAFT_PROMPT_VERSION}
      />

      <PromptPreview
        match={match}
        draft={draft}
        isExample={example === null}
        origin={origin}
      />

      <SourceContextTable rows={sources} />

      <DraftPlayground tasks={pendingTasks} configured={configured} />
    </div>
  );
}
