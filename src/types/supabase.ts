export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      canteens: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          code: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          code?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          code?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canteens_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      menu_items: {
        Row: {
          created_at: string
          id: string
          is_sold_out: boolean
          name: string
          price: number
          updated_at: string
          veg_non_veg: Database["public"]["Enums"]["food_type"]
          tenant_id: string
          canteen_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_sold_out?: boolean
          name: string
          price?: number
          updated_at?: string
          veg_non_veg: Database["public"]["Enums"]["food_type"]
          tenant_id: string
          canteen_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_sold_out?: boolean
          name?: string
          price?: number
          updated_at?: string
          veg_non_veg?: Database["public"]["Enums"]["food_type"]
          tenant_id?: string
          canteen_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_canteen_id_fkey"
            columns: ["canteen_id"]
            referencedRelation: "canteens"
            referencedColumns: ["id"]
          }
        ]
      }
      item_reviews: {
        Row: {
          admin_reply: string | null
          created_at: string
          feedback_text: string | null
          id: string
          menu_item_id: string
          order_id: string
          rating: number
          user_id: string
          tenant_id: string
        }
        Insert: {
          admin_reply?: string | null
          created_at?: string
          feedback_text?: string | null
          id?: string
          menu_item_id: string
          order_id: string
          rating: number
          user_id: string
          tenant_id: string
        }
        Update: {
          admin_reply?: string | null
          created_at?: string
          feedback_text?: string | null
          id?: string
          menu_item_id?: string
          order_id?: string
          rating?: number
          user_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_reviews_menu_item_id_fkey"
            columns: ["menu_item_id"]
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_reviews_order_id_fkey"
            columns: ["order_id"]
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_reviews_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      order_items: {
        Row: {
          id: string
          menu_item_id: string
          order_id: string
          quantity: number
        }
        Insert: {
          id?: string
          menu_item_id: string
          order_id: string
          quantity: number
        }
        Update: {
          id?: string
          menu_item_id?: string
          order_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          collected_at: string | null
          created_at: string
          id: string
          order_number: number
          otp_attempts: number
          otp_code: string
          pickup_time: string
          is_takeaway: boolean
          ready_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          user_id: string
          tenant_id: string
          canteen_id: string
        }
        Insert: {
          accepted_at?: string | null
          collected_at?: string | null
          created_at?: string
          id?: string
          order_number?: number
          otp_attempts?: number
          otp_code: string
          pickup_time: string
          is_takeaway?: boolean
          ready_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          user_id: string
          tenant_id: string
          canteen_id: string
        }
        Update: {
          accepted_at?: string | null
          collected_at?: string | null
          created_at?: string
          id?: string
          order_number?: number
          otp_attempts?: number
          otp_code?: string
          pickup_time?: string
          is_takeaway?: boolean
          ready_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          user_id?: string
          tenant_id?: string
          canteen_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_canteen_id_fkey"
            columns: ["canteen_id"]
            referencedRelation: "canteens"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          id_number: string | null
          name: string | null
          role: Database["public"]["Enums"]["user_role"]
          strike_count: number
          suspended_until: string | null
          tenant_id: string
          canteen_id: string | null
        }
        Insert: {
          created_at?: string
          id: string
          id_number?: string | null
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          strike_count?: number
          suspended_until?: string | null
          tenant_id: string
          canteen_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          id_number?: string | null
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          strike_count?: number
          suspended_until?: string | null
          tenant_id?: string
          canteen_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_canteen_id_fkey"
            columns: ["canteen_id"]
            referencedRelation: "canteens"
            referencedColumns: ["id"]
          }
        ]
      }
      tenants: {
        Row: {
          id: string
          slug: string
          name: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      tenant_settings: {
        Row: {
          tenant_id: string
          display_name: string | null
          logo_url: string | null
          primary_color: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          tenant_id: string
          display_name?: string | null
          logo_url?: string | null
          primary_color?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          tenant_id?: string
          display_name?: string | null
          logo_url?: string | null
          primary_color?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      toggle_sold_out: {
        Args: {
          item_id: string
          new_status: boolean
        }
        Returns: undefined
      }
      place_order_with_otp: {
        Args: {
          p_pickup_time: string
          p_items: Json
          p_is_takeaway?: boolean
          p_canteen_id?: string | null
        }
        Returns: string
      }
      update_order_status: {
        Args: {
          p_order_id: string
          p_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: undefined
      }
      verify_pickup_otp: {
        Args: {
          p_order_id: string
          p_otp: string
          p_is_override?: boolean
        }
        Returns: Json
      }
      cancel_order: {
        Args: {
          p_order_id: string
        }
        Returns: undefined
      }
      mark_order_no_show: {
        Args: {
          p_order_id: string
        }
        Returns: Json
      }
      admin_reset_student_strikes: {
        Args: {
          p_student_id: string
        }
        Returns: Json
      }
      create_tenant: {
        Args: {
          p_slug: string
          p_name: string
        }
        Returns: string
      }
      update_tenant_settings: {
        Args: {
          p_display_name?: string
          p_logo_url?: string
          p_primary_color?: string
          p_timezone?: string
        }
        Returns: undefined
      }
      admin_toggle_tenant: {
        Args: {
          p_tenant_id: string
          p_is_active: boolean
        }
        Returns: undefined
      }
      admin_delete_tenant_cascade: {
        Args: {
          p_tenant_id: string
        }
        Returns: Json
      }
      check_user_tenant_access: {
        Args: {
          p_email: string
          p_tenant_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      food_type: "VEG" | "NON_VEG"
      order_status:
        | "PLACED"
        | "ACCEPTED"
        | "REJECTED"
        | "PREPARING"
        | "READY"
        | "COLLECTED"
      user_role: "STUDENT" | "TEACHER" | "STAFF" | "ADMIN" | "SUPER_ADMIN" | "UNI_ADMIN" | "CANTEEN_ADMIN"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
