"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { ReviewThumbnail } from "@/components/products/review-thumbnail";
import type { ProductFormDefaults } from "@/components/products/product-form-defaults";
import { SubmitButton } from "@/components/patterns/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createProduct, updateProduct } from "@/lib/actions/products";
import type { Tables } from "@/lib/database.types";
import { useFormAction } from "@/lib/hooks/use-form-action";
import type { ProductInput } from "@/lib/validations/product";

const HTTP_URL = /^https?:\/\//i;
const MAX_REVIEW_IMAGES = 20;

function formField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readProductInput(
  formData: FormData,
  reviewImages: string[],
  isActive: boolean
): ProductInput {
  return {
    name: formField(formData, "name"),
    shopee_item_id: formField(formData, "shopee_item_id"),
    price: formField(formData, "price"),
    commission_rate: formField(formData, "commission_rate"),
    affiliate_short_link: formField(formData, "affiliate_short_link"),
    review_images: reviewImages,
    pros_cons_summary: formField(formData, "pros_cons_summary"),
    niche: formField(formData, "niche"),
    is_active: isActive
  };
}

/**
 * One form for create and edit. The review-image editor owns its list in React
 * state (add/remove must be instant) and submits it as a JSON-free string array
 * through the action adapter — never as a raw string.
 */
export function ProductForm({
  product,
  onSuccess,
  onCancel
}: {
  product?: ProductFormDefaults;
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const isEdit = Boolean(product);
  const [reviewImages, setReviewImages] = useState<string[]>(product?.review_images ?? []);
  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);

  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const { state, pending, submit } = useFormAction<Tables<"products">>(
    async (formData) => {
      const input = readProductInput(formData, reviewImages, isActive);
      return product ? updateProduct(product.id, input) : createProduct(input);
    },
    {
      onSuccess: () => {
        toast.success(isEdit ? "Đã cập nhật sản phẩm" : "Đã tạo sản phẩm mới");
        onSuccessRef.current?.();
      },
      onError: (message) => toast.error(message)
    }
  );

  function addImage() {
    const value = imageUrl.trim();

    if (!HTTP_URL.test(value)) {
      setImageError("URL hình ảnh phải bắt đầu bằng http:// hoặc https://.");
      return;
    }
    if (reviewImages.length >= MAX_REVIEW_IMAGES) {
      setImageError(`Bạn chỉ có thể thêm tối đa ${MAX_REVIEW_IMAGES} hình feedback.`);
      return;
    }
    if (reviewImages.includes(value)) {
      setImageError("Hình ảnh này đã có trong danh sách.");
      return;
    }

    setReviewImages((current) => [...current, value]);
    setImageUrl("");
    setImageError(null);
  }

  function handleImageKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Enter adds the URL instead of submitting the whole product form.
      event.preventDefault();
      addImage();
    }
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const imagesError = fieldErrors?.review_images?.[0];

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {state && !state.ok && !state.fieldErrors ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="product-name">Tên sản phẩm</Label>
        <Input
          id="product-name"
          name="name"
          defaultValue={product?.name ?? ""}
          placeholder="vd: Máy lọc không khí Xiaomi Elite"
          maxLength={200}
          autoComplete="off"
          aria-invalid={Boolean(fieldErrors?.name?.[0])}
        />
        {fieldErrors?.name?.[0] ? (
          <p className="text-destructive text-xs">{fieldErrors.name[0]}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="product-shopee-id">Shopee Item ID</Label>
          <Input
            id="product-shopee-id"
            name="shopee_item_id"
            defaultValue={product?.shopee_item_id ?? ""}
            placeholder="Không bắt buộc"
            maxLength={64}
            autoComplete="off"
            aria-invalid={Boolean(fieldErrors?.shopee_item_id?.[0])}
          />
          {fieldErrors?.shopee_item_id?.[0] ? (
            <p className="text-destructive text-xs">{fieldErrors.shopee_item_id[0]}</p>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="product-niche">Ngách sản phẩm</Label>
          <Input
            id="product-niche"
            name="niche"
            defaultValue={product?.niche ?? ""}
            placeholder="vd: gia dụng, thời trang"
            maxLength={100}
            autoComplete="off"
            aria-invalid={Boolean(fieldErrors?.niche?.[0])}
          />
          {fieldErrors?.niche?.[0] ? (
            <p className="text-destructive text-xs">{fieldErrors.niche[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="product-price">Giá (VNĐ)</Label>
          <Input
            id="product-price"
            name="price"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={product?.price ?? ""}
            placeholder="150000"
            aria-invalid={Boolean(fieldErrors?.price?.[0])}
          />
          {fieldErrors?.price?.[0] ? (
            <p className="text-destructive text-xs">{fieldErrors.price[0]}</p>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="product-commission">Tỷ lệ hoa hồng (%)</Label>
          <Input
            id="product-commission"
            name="commission_rate"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.01}
            defaultValue={product?.commission_rate ?? ""}
            placeholder="15.5"
            aria-invalid={Boolean(fieldErrors?.commission_rate?.[0])}
          />
          {fieldErrors?.commission_rate?.[0] ? (
            <p className="text-destructive text-xs">{fieldErrors.commission_rate[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="product-affiliate-link">Link rút gọn Affiliate</Label>
        <Input
          id="product-affiliate-link"
          name="affiliate_short_link"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={product?.affiliate_short_link ?? ""}
          placeholder="https://s.shopee.vn/..."
          aria-invalid={Boolean(fieldErrors?.affiliate_short_link?.[0])}
        />
        {fieldErrors?.affiliate_short_link?.[0] ? (
          <p className="text-destructive text-xs">{fieldErrors.affiliate_short_link[0]}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="product-pros-cons">Tóm tắt ưu / nhược điểm</Label>
        <Textarea
          id="product-pros-cons"
          name="pros_cons_summary"
          defaultValue={product?.pros_cons_summary ?? ""}
          placeholder="Điểm người mua thích và chê thực tế. AI sẽ sử dụng thông tin này để viết bình luận tự nhiên."
          maxLength={1000}
          rows={4}
          aria-invalid={Boolean(fieldErrors?.pros_cons_summary?.[0])}
        />
        {fieldErrors?.pros_cons_summary?.[0] ? (
          <p className="text-destructive text-xs">{fieldErrors.pros_cons_summary[0]}</p>
        ) : null}
      </div>

      <div className="border-t pt-4">
        <div className="grid gap-2">
          <Label htmlFor="product-review-url">Ảnh feedback thực tế</Label>
          <p className="text-muted-foreground text-xs">
            Ảnh review thực tế của người mua kèm trong bình luận. Dán URL ảnh rồi nhấn Thêm.
          </p>

          <div className="flex gap-2">
            <Input
              id="product-review-url"
              value={imageUrl}
              onChange={(event) => {
                setImageUrl(event.target.value);
                setImageError(null);
              }}
              onKeyDown={handleImageKeyDown}
              placeholder="https://..."
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={Boolean(imageError || imagesError)}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={addImage}
              className="shrink-0"
            >
              <PlusIcon />
              Thêm
            </Button>
          </div>

          {imageError ? <p className="text-destructive text-xs">{imageError}</p> : null}
          {imagesError ? <p className="text-destructive text-xs">{imagesError}</p> : null}

          {reviewImages.length === 0 ? (
            <p className="text-muted-foreground text-xs">Chưa có ảnh feedback nào.</p>
          ) : (
            <ul className="mt-1 space-y-2">
              {reviewImages.map((url, index) => (
                <li key={`${url}-${index}`} className="flex items-center gap-2 rounded-lg border p-2">
                  <ReviewThumbnail
                    src={url}
                    alt="Xem trước ảnh review"
                    sizes="40px"
                    className="size-10 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs">{url}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setReviewImages((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                    aria-label={`Xóa ảnh ${url}`}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-muted-foreground text-xs">
            {reviewImages.length}/{MAX_REVIEW_IMAGES} ảnh
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="product-active">Kích hoạt</Label>
          <p className="text-muted-foreground text-xs">Sản phẩm tắt kích hoạt sẽ bị bỏ qua khi ghép nối tự động.</p>
        </div>
        <Switch
          id="product-active"
          checked={isActive}
          onCheckedChange={setIsActive}
          className="relative before:absolute before:-inset-2.5 before:content-['']"
        />
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onCancel}
            className="w-full sm:w-auto"
          >
            Hủy
          </Button>
        ) : null}
        <SubmitButton
          size="lg"
          pending={pending}
          pendingLabel={isEdit ? "Đang lưu…" : "Đang tạo…"}
          className="w-full sm:w-auto"
        >
          {isEdit ? "Lưu thay đổi" : "Tạo sản phẩm"}
        </SubmitButton>
      </div>
    </form>
  );
}
