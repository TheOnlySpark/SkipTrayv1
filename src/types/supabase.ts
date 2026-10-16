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
      canteen_tax_configs: {
        Row: {
          id: string
          canteen_id: string
          tenant_id: string
          gstin: string | null
          legal_business_name: string | null
          state_code: string
          state_name: string
          price_mode: 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE'
          default_food_gst_rate: number
          service_fee_gst_rate: number
          is_gst_registered: boolean
          is_composition_scheme: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          canteen_id: string
          tenant_id: string
          gstin?: string | null
          legal_business_name?: string | null
          state_code?: string
          state_name?: string
          price_mode?: 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE'
          default_food_gst_rate?: number
          service_fee_gst_rate?: number
          is_gst_registered?: boolean
          is_composition_scheme?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          canteen_id?: string
          tenant_id?: string
          gstin?: string | null
          legal_business_name?: string | null
          state_code?: string
          state_name?: string
          price_mode?: 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE'
          default_food_gst_rate?: number
          service_fee_gst_rate?: number
          is_gst_registered?: boolean
          is_composition_scheme?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lunch_slot_configs: {
        Row: {
          id: string
          canteen_id: string | null
          tenant_id: string | null
          service_start_time: string
          service_end_time: string
          slot_duration_minutes: number
          min_notice_minutes: number
          is_lunch_enabled: boolean
          disabled_slots: Json
          slot_capacities: Json
          custom_slots: Json
          max_concurrent_orders: number | null
          default_prep_time_minutes: number | null
          order_cutoff_minutes: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          canteen_id?: string | null
          tenant_id?: string | null
          service_start_time?: string
          service_end_time?: string
          slot_duration_minutes?: number
          min_notice_minutes?: number
          is_lunch_enabled?: boolean
          disabled_slots?: Json
          slot_capacities?: Json
          custom_slots?: Json
          max_concurrent_orders?: number | null
          default_prep_time_minutes?: number | null
          order_cutoff_minutes?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          canteen_id?: string | null
          tenant_id?: string | null
          service_start_time?: string
          service_end_time?: string
          slot_duration_minutes?: number
          min_notice_minutes?: number
          is_lunch_enabled?: boolean
          disabled_slots?: Json
          slot_capacities?: Json
          custom_slots?: Json
          max_concurrent_orders?: number | null
          default_prep_time_minutes?: number | null
          order_cutoff_minutes?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lunch_slot_configs_canteen_id_fkey"
            columns: ["canteen_id"]
            referencedRelation: "canteens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lunch_slot_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      menu_items: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_sold_out: boolean
          name: string
          price: number
          prep_time_minutes: number | null
          stock_quantity: number | null
          gst_rate_percent: number | null
          hsn_code: string | null
          updated_at: string
          veg_non_veg: Database["public"]["Enums"]["food_type"]
          tenant_id: string
          canteen_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_sold_out?: boolean
          name: string
          price?: number
          prep_time_minutes?: number | null
          stock_quantity?: number | null
          gst_rate_percent?: number | null
          hsn_code?: string | null
          updated_at?: string
          veg_non_veg: Database["public"]["Enums"]["food_type"]
          tenant_id: string
          canteen_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_sold_out?: boolean
          name?: string
          price?: number
          prep_time_minutes?: number | null
          stock_quantity?: number | null
          gst_rate_percent?: number | null
          hsn_code?: string | null
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
          requested_pickup_time: string | null
          estimated_prep_duration_minutes: number | null
          planned_prep_start_time: string | null
          target_ready_by_time: string | null
          preparation_started_at: string | null
          is_takeaway: boolean
          ready_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          user_id: string
          tenant_id: string
          canteen_id: string
          total_tax_amount: number | null
          tax_snapshot: Json | null
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
          requested_pickup_time?: string | null
          estimated_prep_duration_minutes?: number | null
          planned_prep_start_time?: string | null
          target_ready_by_time?: string | null
          preparation_started_at?: string | null
          is_takeaway?: boolean
          ready_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          user_id: string
          tenant_id: string
          canteen_id: string
          total_tax_amount?: number | null
          tax_snapshot?: Json | null
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
          requested_pickup_time?: string | null
          estimated_prep_duration_minutes?: number | null
          planned_prep_start_time?: string | null
          target_ready_by_time?: string | null
          preparation_started_at?: string | null
          is_takeaway?: boolean
          ready_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          user_id?: string
          tenant_id?: string
          canteen_id?: string
          total_tax_amount?: number | null
          tax_snapshot?: Json | null
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
      order_ledger: {
        Row: {
          id: string
          order_id: string
          student_id: string
          canteen_id: string
          payment_status: string
          food_subtotal: number
          commission_fee: number
          target_net: number
          gross_payable: number
          gateway_fee: number
          gw_deduction: number
          net_settled: number
          canteen_payable: number
          platform_net: number
          tax_mode: string | null
          supply_type: string | null
          taxable_food_amount: number | null
          food_gst_rate: number | null
          food_gst_amount: number | null
          cgst_rate: number | null
          cgst_amount: number | null
          sgst_rate: number | null
          sgst_amount: number | null
          igst_rate: number | null
          igst_amount: number | null
          fee_gst_amount: number | null
          total_tax_amount: number | null
          tax_snapshot: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_id: string
          student_id: string
          canteen_id: string
          payment_status?: string
          food_subtotal: number
          commission_fee: number
          target_net: number
          gross_payable: number
          gateway_fee: number
          gw_deduction: number
          net_settled: number
          canteen_payable: number
          platform_net: number
          tax_mode?: string | null
          supply_type?: string | null
          taxable_food_amount?: number | null
          food_gst_rate?: number | null
          food_gst_amount?: number | null
          cgst_rate?: number | null
          cgst_amount?: number | null
          sgst_rate?: number | null
          sgst_amount?: number | null
          igst_rate?: number | null
          igst_amount?: number | null
          fee_gst_amount?: number | null
          total_tax_amount?: number | null
          tax_snapshot?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          student_id?: string
          canteen_id?: string
          payment_status?: string
          food_subtotal?: number
          commission_fee?: number
          target_net?: number
          gross_payable?: number
          gateway_fee?: number
          gw_deduction?: number
          net_settled?: number
          canteen_payable?: number
          platform_net?: number
          tax_mode?: string | null
          supply_type?: string | null
          taxable_food_amount?: number | null
          food_gst_rate?: number | null
          food_gst_amount?: number | null
          cgst_rate?: number | null
          cgst_amount?: number | null
          sgst_rate?: number | null
          sgst_amount?: number | null
          igst_rate?: number | null
          igst_amount?: number | null
          fee_gst_amount?: number | null
          total_tax_amount?: number | null
          tax_snapshot?: Json | null
          created_at?: string
          updated_at?: string
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
      inv_products: {
        Row: {
          id: string
          tenant_id: string
          product_name: string
          category: string | null
          product_type: Database["public"]["Enums"]["inventory_product_type"]
          sku: string | null
          purchase_price: number | null
          selling_price: number
          current_stock: number
          min_stock: number
          expiry_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id?: string
          product_name: string
          category?: string | null
          product_type: Database["public"]["Enums"]["inventory_product_type"]
          sku?: string | null
          purchase_price?: number | null
          selling_price: number
          current_stock?: number
          min_stock?: number
          expiry_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          product_name?: string
          category?: string | null
          product_type?: Database["public"]["Enums"]["inventory_product_type"]
          sku?: string | null
          purchase_price?: number | null
          selling_price?: number
          current_stock?: number
          min_stock?: number
          expiry_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_products_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      user_notifications: {
        Row: {
          id: string
          user_id: string
          order_id: string | null
          order_number: number | null
          status: string
          title: string
          message: string
          read: boolean
          created_at: string
        }
        Insert: {
          id: string
          user_id: string
          order_id?: string | null
          order_number?: number | null
          status: string
          title: string
          message: string
          read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          order_id?: string | null
          order_number?: number | null
          status?: string
          title?: string
          message?: string
          read?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_order_id_fkey"
            columns: ["order_id"]
            referencedRelation: "orders"
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
      inventory_product_type: "FRESH_FOOD" | "PACKAGED" | "SOFT_DRINK"
      inventory_transaction_type: "STOCK_IN" | "SALE" | "WASTAGE" | "ADJUSTMENT"
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
