
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "affiliate_conversions": {
                  Row: {
                    "converted_at": string,"created_at": string,"estimated_commission": number,"external_order_id": string | null,"id": string,"order_amount": number,"status": Database["public"]['Enums']["conversion_status"],"sub_id": string,"task_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "converted_at"?: string,"created_at"?: string,"estimated_commission"?: number,"external_order_id"?: string | null,"id"?: string,"order_amount"?: number,"status"?: Database["public"]['Enums']["conversion_status"],"sub_id": string,"task_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "converted_at"?: string,"created_at"?: string,"estimated_commission"?: number,"external_order_id"?: string | null,"id"?: string,"order_amount"?: number,"status"?: Database["public"]['Enums']["conversion_status"],"sub_id"?: string,"task_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "affiliate_conversions_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "comment_tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "affiliate_conversions_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "v_task_roi"
      referencedColumns: ["task_id"]
    }
                  ]
                },"comment_tasks": {
                  Row: {
                    "ai_draft_comment": string | null,"approved_at": string | null,"assigned_account_id": string | null,"attempt_count": number,"claimed_at": string | null,"claimed_by": string | null,"created_at": string,"executed_at": string | null,"execution_mode": Database["public"]['Enums']["execution_mode"],"execution_note": string | null,"id": string,"last_error": string | null,"match_score": number | null,"matched_product_id": string | null,"post_content": string | null,"post_images": NonNullable<Json>,"post_url": string,"review_note": string | null,"secondary_account_id": string | null,"selected_review_image": string | null,"source_id": string | null,"status": Database["public"]['Enums']["task_status"],"sub_id_code": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_draft_comment"?: string | null,"approved_at"?: string | null,"assigned_account_id"?: string | null,"attempt_count"?: number,"claimed_at"?: string | null,"claimed_by"?: string | null,"created_at"?: string,"executed_at"?: string | null,"execution_mode"?: Database["public"]['Enums']["execution_mode"],"execution_note"?: string | null,"id"?: string,"last_error"?: string | null,"match_score"?: number | null,"matched_product_id"?: string | null,"post_content"?: string | null,"post_images"?: NonNullable<Json>,"post_url": string,"review_note"?: string | null,"secondary_account_id"?: string | null,"selected_review_image"?: string | null,"source_id"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"sub_id_code"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "ai_draft_comment"?: string | null,"approved_at"?: string | null,"assigned_account_id"?: string | null,"attempt_count"?: number,"claimed_at"?: string | null,"claimed_by"?: string | null,"created_at"?: string,"executed_at"?: string | null,"execution_mode"?: Database["public"]['Enums']["execution_mode"],"execution_note"?: string | null,"id"?: string,"last_error"?: string | null,"match_score"?: number | null,"matched_product_id"?: string | null,"post_content"?: string | null,"post_images"?: NonNullable<Json>,"post_url"?: string,"review_note"?: string | null,"secondary_account_id"?: string | null,"selected_review_image"?: string | null,"source_id"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"sub_id_code"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comment_tasks_assigned_account_id_fkey"
      columns: ["assigned_account_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comment_tasks_assigned_account_id_fkey"
      columns: ["assigned_account_id"]
isOneToOne: false
      referencedRelation: "v_account_daily_usage"
      referencedColumns: ["account_id"]
    },{
      foreignKeyName: "comment_tasks_assigned_account_id_fkey"
      columns: ["assigned_account_id"]
isOneToOne: false
      referencedRelation: "v_account_performance"
      referencedColumns: ["account_id"]
    },{
      foreignKeyName: "comment_tasks_matched_product_id_fkey"
      columns: ["matched_product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comment_tasks_secondary_account_id_fkey"
      columns: ["secondary_account_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comment_tasks_secondary_account_id_fkey"
      columns: ["secondary_account_id"]
isOneToOne: false
      referencedRelation: "v_account_daily_usage"
      referencedColumns: ["account_id"]
    },{
      foreignKeyName: "comment_tasks_secondary_account_id_fkey"
      columns: ["secondary_account_id"]
isOneToOne: false
      referencedRelation: "v_account_performance"
      referencedColumns: ["account_id"]
    },{
      foreignKeyName: "comment_tasks_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "target_sources"
      referencedColumns: ["id"]
    }
                  ]
                },"operators": {
                  Row: {
                    "created_at": string,"email": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"products": {
                  Row: {
                    "affiliate_short_link": string,"commission_rate": number | null,"created_at": string,"embedding": string | null,"id": string,"is_active": boolean,"name": string,"niche": string | null,"price": number | null,"pros_cons_summary": string | null,"review_images": NonNullable<Json>,"shopee_item_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "affiliate_short_link": string,"commission_rate"?: number | null,"created_at"?: string,"embedding"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"niche"?: string | null,"price"?: number | null,"pros_cons_summary"?: string | null,"review_images"?: NonNullable<Json>,"shopee_item_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "affiliate_short_link"?: string,"commission_rate"?: number | null,"created_at"?: string,"embedding"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"niche"?: string | null,"price"?: number | null,"pros_cons_summary"?: string | null,"review_images"?: NonNullable<Json>,"shopee_item_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"social_accounts": {
                  Row: {
                    "avatar_set_at": string | null,"bio": string | null,"bio_link_url": string | null,"browser_profile_id": string | null,"cooldown_until": string | null,"cover_set_at": string | null,"created_at": string,"credentials_imported_at": string | null,"daily_comment_limit": number,"daily_warming_limit": number,"id": string,"last_action_at": string | null,"last_warmed_at": string | null,"login_identifier": string | null,"login_password_enc": string | null,"min_action_gap_minutes": number,"name": string,"notes": string | null,"persona_schedule": NonNullable<Json>,"persona_type": string,"platform": Database["public"]['Enums']["social_platform"],"profile_built_at": string | null,"proxy_host": string | null,"proxy_ip": string | null,"proxy_password_enc": string | null,"proxy_port": number | null,"proxy_username": string | null,"status": Database["public"]['Enums']["account_status"],"trust_score": number,"twofa_secret_enc": string | null,"updated_at": string,"warmup_enabled": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_set_at"?: string | null,"bio"?: string | null,"bio_link_url"?: string | null,"browser_profile_id"?: string | null,"cooldown_until"?: string | null,"cover_set_at"?: string | null,"created_at"?: string,"credentials_imported_at"?: string | null,"daily_comment_limit"?: number,"daily_warming_limit"?: number,"id"?: string,"last_action_at"?: string | null,"last_warmed_at"?: string | null,"login_identifier"?: string | null,"login_password_enc"?: string | null,"min_action_gap_minutes"?: number,"name": string,"notes"?: string | null,"persona_schedule"?: NonNullable<Json>,"persona_type": string,"platform"?: Database["public"]['Enums']["social_platform"],"profile_built_at"?: string | null,"proxy_host"?: string | null,"proxy_ip"?: string | null,"proxy_password_enc"?: string | null,"proxy_port"?: number | null,"proxy_username"?: string | null,"status"?: Database["public"]['Enums']["account_status"],"trust_score"?: number,"twofa_secret_enc"?: string | null,"updated_at"?: string,"warmup_enabled"?: boolean
                  }
                  Update: {
                    "avatar_set_at"?: string | null,"bio"?: string | null,"bio_link_url"?: string | null,"browser_profile_id"?: string | null,"cooldown_until"?: string | null,"cover_set_at"?: string | null,"created_at"?: string,"credentials_imported_at"?: string | null,"daily_comment_limit"?: number,"daily_warming_limit"?: number,"id"?: string,"last_action_at"?: string | null,"last_warmed_at"?: string | null,"login_identifier"?: string | null,"login_password_enc"?: string | null,"min_action_gap_minutes"?: number,"name"?: string,"notes"?: string | null,"persona_schedule"?: NonNullable<Json>,"persona_type"?: string,"platform"?: Database["public"]['Enums']["social_platform"],"profile_built_at"?: string | null,"proxy_host"?: string | null,"proxy_ip"?: string | null,"proxy_password_enc"?: string | null,"proxy_port"?: number | null,"proxy_username"?: string | null,"status"?: Database["public"]['Enums']["account_status"],"trust_score"?: number,"twofa_secret_enc"?: string | null,"updated_at"?: string,"warmup_enabled"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"target_sources": {
                  Row: {
                    "created_at": string,"group_rules": string | null,"id": string,"is_active": boolean,"last_scanned_at": string | null,"name": string,"niche": string | null,"scan_interval_mins": number,"source_type": Database["public"]['Enums']["source_type"],"tone_of_voice": string | null,"updated_at": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_rules"?: string | null,"id"?: string,"is_active"?: boolean,"last_scanned_at"?: string | null,"name": string,"niche"?: string | null,"scan_interval_mins"?: number,"source_type": Database["public"]['Enums']["source_type"],"tone_of_voice"?: string | null,"updated_at"?: string,"url": string
                  }
                  Update: {
                    "created_at"?: string,"group_rules"?: string | null,"id"?: string,"is_active"?: boolean,"last_scanned_at"?: string | null,"name"?: string,"niche"?: string | null,"scan_interval_mins"?: number,"source_type"?: Database["public"]['Enums']["source_type"],"tone_of_voice"?: string | null,"updated_at"?: string,"url"?: string
                  }
                  Relationships: [
                    
                  ]
                },"warming_runs": {
                  Row: {
                    "account_id": string,"content": string | null,"created_at": string,"error": string | null,"executed_at": string,"id": string,"kind": Database["public"]['Enums']["warming_kind"],"post_url": string | null,"sandbox": boolean,"status": Database["public"]['Enums']["warming_status"],"target_account_id": string | null,"target_post_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"content"?: string | null,"created_at"?: string,"error"?: string | null,"executed_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["warming_kind"],"post_url"?: string | null,"sandbox"?: boolean,"status"?: Database["public"]['Enums']["warming_status"],"target_account_id"?: string | null,"target_post_url"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"content"?: string | null,"created_at"?: string,"error"?: string | null,"executed_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["warming_kind"],"post_url"?: string | null,"sandbox"?: boolean,"status"?: Database["public"]['Enums']["warming_status"],"target_account_id"?: string | null,"target_post_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "warming_runs_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "warming_runs_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "v_account_daily_usage"
      referencedColumns: ["account_id"]
    },{
      foreignKeyName: "warming_runs_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "v_account_performance"
      referencedColumns: ["account_id"]
    },{
      foreignKeyName: "warming_runs_target_account_id_fkey"
      columns: ["target_account_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "warming_runs_target_account_id_fkey"
      columns: ["target_account_id"]
isOneToOne: false
      referencedRelation: "v_account_daily_usage"
      referencedColumns: ["account_id"]
    },{
      foreignKeyName: "warming_runs_target_account_id_fkey"
      columns: ["target_account_id"]
isOneToOne: false
      referencedRelation: "v_account_performance"
      referencedColumns: ["account_id"]
    }
                  ]
                },"worker_heartbeats": {
                  Row: {
                    "alerted_at": string | null,"host": string | null,"last_seen_at": string,"mode": string | null,"worker": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alerted_at"?: string | null,"host"?: string | null,"last_seen_at"?: string,"mode"?: string | null,"worker": string
                  }
                  Update: {
                    "alerted_at"?: string | null,"host"?: string | null,"last_seen_at"?: string,"mode"?: string | null,"worker"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "v_account_daily_usage": {
                  Row: {
                    "account_id": string | null,"comments_24h": number | null,"last_comment_at": string | null,"last_warming_at": string | null,"warming_24h": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "account_id"?: string | null,"comments_24h"?: never,"last_comment_at"?: never,"last_warming_at"?: never,"warming_24h"?: never
                         }
                        Update: {
                           "account_id"?: string | null,"comments_24h"?: never,"last_comment_at"?: never,"last_warming_at"?: never,"warming_24h"?: never
                         }
                        Relationships: [
                    
                  ]
                },"v_account_performance": {
                  Row: {
                    "account_id": string | null,"account_name": string | null,"comments_failed": number | null,"comments_published": number | null,"last_executed_at": string | null,"persona_type": string | null,"revenue": number | null,"settled_commission": number | null,"status": Database["public"]['Enums']["account_status"] | null,"trust_score": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_task_roi": {
                  Row: {
                    "account_name": string | null,"commission": number | null,"commission_rate": number | null,"created_at": string | null,"executed_at": string | null,"execution_mode": Database["public"]['Enums']["execution_mode"] | null,"orders": number | null,"post_url": string | null,"product_name": string | null,"revenue": number | null,"settled_commission": number | null,"source_name": string | null,"source_type": Database["public"]['Enums']["source_type"] | null,"status": Database["public"]['Enums']["task_status"] | null,"sub_id_code": string | null,"task_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "account_stats":
{ Args: Record<PropertyKey, never>; Returns: {
              "avg_trust": number,"status": Database["public"]['Enums']["account_status"],"total": number
            }[]
                           },
"analytics_by_account":
{ Args: { "p_since"?: string }; Returns: {
              "commission": number,"label": string,"orders": number,"revenue": number
            }[]
                           },
"analytics_by_source":
{ Args: { "p_since"?: string }; Returns: {
              "commission": number,"label": string,"orders": number,"revenue": number
            }[]
                           },
"analytics_revenue_series":
{ Args: { "p_since"?: string }; Returns: {
              "commission": number,"day": string,"orders": number,"revenue": number
            }[]
                           },
"analytics_summary":
{ Args: { "p_since"?: string }; Returns: {
              "canceled_commission": number,"commission": number,"orders": number,"pending_commission": number,"revenue": number,"settled_commission": number,"tasks_executed": number,"tasks_with_orders": number
            }[]
                           },
"analytics_task_roi":
{ Args: { "p_limit"?: number,"p_since"?: string }; Returns: {
              "account_name": string,"commission": number,"commission_rate": number,"created_at": string,"executed_at": string,"execution_mode": Database["public"]['Enums']["execution_mode"],"orders": number,"post_url": string,"product_name": string,"revenue": number,"settled_commission": number,"source_name": string,"source_type": Database["public"]['Enums']["source_type"],"status": Database["public"]['Enums']["task_status"],"sub_id_code": string,"task_id": string
            }[]
                           },
"claim_comment_tasks":
{ Args: { "p_limit"?: number,"p_worker": string }; Returns: {
              "ai_draft_comment": string | null,
"approved_at": string | null,
"assigned_account_id": string | null,
"attempt_count": number,
"claimed_at": string | null,
"claimed_by": string | null,
"created_at": string,
"executed_at": string | null,
"execution_mode": Database["public"]['Enums']["execution_mode"],
"execution_note": string | null,
"id": string,
"last_error": string | null,
"match_score": number | null,
"matched_product_id": string | null,
"post_content": string | null,
"post_images": NonNullable<Json>,
"post_url": string,
"review_note": string | null,
"secondary_account_id": string | null,
"selected_review_image": string | null,
"source_id": string | null,
"status": Database["public"]['Enums']["task_status"],
"sub_id_code": string | null,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "comment_tasks"
        isOneToOne: false
        isSetofReturn: true
      } },
"is_operator":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"match_products":
{ Args: { "p_embedding": string,"p_limit"?: number }; Returns: {
              "id": string,"name": string,"niche": string,"pros_cons_summary": string,"similarity": number
            }[]
                           },
"product_stats":
{ Args: Record<PropertyKey, never>; Returns: {
              "active": number,"avg_commission": number,"total": number,"with_reviews": number
            }[]
                           },
"queue_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "status": Database["public"]['Enums']["task_status"],"total": number
            }[]
                           },
"reconcile_conversions":
{ Args: Record<PropertyKey, never>; Returns: {
              "attributed": number,"remaining": number
            }[]
                           }
          }
          Enums: {
            "account_status": "active"|"cooldown"|"checkpoint","conversion_status": "pending"|"settled"|"canceled","execution_mode": "single"|"seeding_2_accounts","social_platform": "facebook"|"instagram"|"tiktok"|"threads","source_type": "group"|"fanpage"|"kol"|"forum","task_status": "pending_approval"|"queued"|"running"|"completed"|"failed"|"rejected","warming_kind": "lifestyle_post"|"cross_warm"|"profile_setup","warming_status": "completed"|"failed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "account_status": ["active", "cooldown", "checkpoint"],"conversion_status": ["pending", "settled", "canceled"],"execution_mode": ["single", "seeding_2_accounts"],"social_platform": ["facebook", "instagram", "tiktok", "threads"],"source_type": ["group", "fanpage", "kol", "forum"],"task_status": ["pending_approval", "queued", "running", "completed", "failed", "rejected"],"warming_kind": ["lifestyle_post", "cross_warm", "profile_setup"],"warming_status": ["completed", "failed"]
          }
        }
} as const
