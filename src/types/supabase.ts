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
      menu_items: {
        Row: {
          created_at: string
          id: string
          is_sold_out: boolean
          name: string
          updated_at: string
          veg_non_veg: Database["public"]["Enums"]["food_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          is_sold_out?: boolean
          name: string
          updated_at?: string
          veg_non_veg: Database["public"]["Enums"]["food_type"]
        }
        Update: {
          created_at?: string
          id?: string
          is_sold_out?: boolean
          name?: string
          updated_at?: string
          veg_non_veg?: Database["public"]["Enums"]["food_type"]
        }
        Relationships: []
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
          ready_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          user_id: string
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
          ready_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          user_id: string
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
          ready_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
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
        }
        Insert: {
          created_at?: string
          id: string
          id_number?: string | null
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          id?: string
          id_number?: string | null
          name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            referencedRelation: "users"
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
      user_role: "STUDENT" | "TEACHER" | "STAFF" | "ADMIN"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
