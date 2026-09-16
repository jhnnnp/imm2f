export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string;
          created_at?: string;
        };
        Update: {
          display_name?: string;
        };
        Relationships: [];
      };
      couples: {
        Row: {
          id: string;
          name: string | null;
          revision_id: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name?: string | null;
          revision_id?: number;
          created_at?: string;
        };
        Update: {
          name?: string | null;
          revision_id?: number;
        };
        Relationships: [];
      };
      couple_members: {
        Row: {
          couple_id: string;
          user_id: string;
          role: "owner" | "partner";
          joined_at: string;
        };
        Insert: {
          couple_id: string;
          user_id: string;
          role?: "owner" | "partner";
          joined_at?: string;
        };
        Update: {
          role?: "owner" | "partner";
        };
        Relationships: [];
      };
      couple_invites: {
        Row: {
          id: string;
          couple_id: string;
          inviter_id: string;
          token: string;
          status: "pending" | "accepted" | "revoked" | "expired";
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          inviter_id: string;
          token: string;
          status?: "pending" | "accepted" | "revoked" | "expired";
          expires_at?: string;
          created_at?: string;
        };
        Update: {
          status?: "pending" | "accepted" | "revoked" | "expired";
        };
        Relationships: [];
      };
      places: {
        Row: {
          id: string;
          couple_id: string;
          name: string;
          category: string;
          category_label: string;
          district: string;
          description: string;
          duration_minutes: number;
          expected_cost_two: number | null;
          lng: number | null;
          lat: number | null;
          image: string | null;
          visual_tone: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          address: string;
          road_address: string | null;
          phone: string | null;
          map_url: string | null;
          opening_hours: string | null;
          external_source: "kakao" | "manual" | "tourapi";
          external_place_id: string | null;
        };
        Insert: {
          id?: string;
          couple_id: string;
          name: string;
          category: string;
          category_label: string;
          district?: string;
          description?: string;
          duration_minutes?: number;
          expected_cost_two?: number | null;
          lng?: number | null;
          lat?: number | null;
          image?: string | null;
          visual_tone?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          address?: string;
          road_address?: string | null;
          phone?: string | null;
          map_url?: string | null;
          opening_hours?: string | null;
          external_source?: "kakao" | "manual" | "tourapi";
          external_place_id?: string | null;
        };
        Update: {
          name?: string;
          category?: string;
          category_label?: string;
          district?: string;
          description?: string;
          duration_minutes?: number;
          expected_cost_two?: number | null;
          lng?: number | null;
          lat?: number | null;
          image?: string | null;
          visual_tone?: string;
          updated_at?: string;
          address?: string;
          road_address?: string | null;
          phone?: string | null;
          map_url?: string | null;
          opening_hours?: string | null;
        };
        Relationships: [];
      };
      place_preferences: {
        Row: {
          place_id: string;
          user_id: string;
          status: string;
          fit: number;
          updated_at: string;
        };
        Insert: {
          place_id: string;
          user_id: string;
          status?: string;
          fit?: number;
          updated_at?: string;
        };
        Update: {
          status?: string;
          fit?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          couple_id: string;
          kind: "date" | "trip";
          title: string;
          subtitle: string;
          start_date: string | null;
          day_count: number;
          revision_id: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          kind: "date" | "trip";
          title?: string;
          subtitle?: string;
          start_date?: string | null;
          day_count?: number;
          revision_id?: number;
          updated_at?: string;
        };
        Update: {
          title?: string;
          subtitle?: string;
          start_date?: string | null;
          day_count?: number;
          revision_id?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      plan_items: {
        Row: {
          id: string;
          plan_id: string;
          client_id: string;
          place_id: string;
          place_name: string;
          category: string;
          start_time: string;
          duration_minutes: number;
          expected_cost: number;
          sort_order: number;
          memo: string;
          day_index: number;
        };
        Insert: {
          id?: string;
          plan_id: string;
          client_id: string;
          place_id?: string;
          place_name: string;
          category?: string;
          start_time?: string;
          duration_minutes?: number;
          expected_cost?: number;
          sort_order?: number;
          memo?: string;
          day_index?: number;
        };
        Update: {
          client_id?: string;
          place_id?: string;
          place_name?: string;
          category?: string;
          start_time?: string;
          duration_minutes?: number;
          expected_cost?: number;
          sort_order?: number;
          memo?: string;
          day_index?: number;
        };
        Relationships: [];
      };
      activities: {
        Row: {
          id: string;
          couple_id: string;
          actor_user_id: string | null;
          entity_type: string;
          entity_id: string;
          action: string;
          title: string;
          detail: string;
          before_value: Json | null;
          after_value: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          actor_user_id?: string | null;
          entity_type: string;
          entity_id?: string;
          action: string;
          title?: string;
          detail?: string;
          before_value?: Json | null;
          after_value?: Json | null;
          created_at?: string;
        };
        Update: {
          title?: string;
          detail?: string;
        };
        Relationships: [];
      };
      plan_versions: {
        Row: {
          id: string;
          couple_id: string;
          plan_id: string;
          plan_kind: "date" | "trip";
          version_number: number;
          snapshot: Json;
          change_summary: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          plan_id: string;
          plan_kind: "date" | "trip";
          version_number: number;
          snapshot?: Json;
          change_summary?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          change_summary?: string;
          snapshot?: Json;
        };
        Relationships: [];
      };
      email_outbox: {
        Row: {
          id: string;
          couple_id: string;
          recipient_user_id: string | null;
          subject: string;
          body: string;
          status: "queued" | "sent" | "failed" | "skipped";
          created_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          recipient_user_id?: string | null;
          subject: string;
          body: string;
          status?: "queued" | "sent" | "failed" | "skipped";
          created_at?: string;
        };
        Update: {
          status?: "queued" | "sent" | "failed" | "skipped";
        };
        Relationships: [];
      };
      memories: {
        Row: {
          id: string;
          couple_id: string;
          memory_type: "free" | "trip" | "date";
          place_id: string | null;
          title: string;
          happened_on: string;
          description: string;
          location_label: string;
          lng: number | null;
          lat: number | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          memory_type?: "free" | "trip" | "date";
          place_id?: string | null;
          title: string;
          happened_on?: string;
          description?: string;
          location_label?: string;
          lng?: number | null;
          lat?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          memory_type?: "free" | "trip" | "date";
          place_id?: string | null;
          title?: string;
          happened_on?: string;
          description?: string;
          location_label?: string;
          lng?: number | null;
          lat?: number | null;
        };
        Relationships: [];
      };
      memory_photos: {
        Row: {
          id: string;
          memory_id: string;
          storage_url: string;
          latitude: number | null;
          longitude: number | null;
          captured_at: string | null;
          caption: string;
          sort_order: number;
          storage_path: string | null;
          original_filename: string;
          mime_type: string;
          file_size: number | null;
          width: number | null;
          height: number | null;
          camera_make: string;
          camera_model: string;
          orientation: number | null;
          location_source: "none" | "exif" | "place" | "manual";
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          memory_id: string;
          storage_url: string;
          latitude?: number | null;
          longitude?: number | null;
          captured_at?: string | null;
          caption?: string;
          sort_order?: number;
          storage_path?: string | null;
          original_filename?: string;
          mime_type?: string;
          file_size?: number | null;
          width?: number | null;
          height?: number | null;
          camera_make?: string;
          camera_model?: string;
          orientation?: number | null;
          location_source?: "none" | "exif" | "place" | "manual";
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          storage_url?: string;
          latitude?: number | null;
          longitude?: number | null;
          captured_at?: string | null;
          caption?: string;
          sort_order?: number;
          storage_path?: string | null;
          original_filename?: string;
          mime_type?: string;
          file_size?: number | null;
          width?: number | null;
          height?: number | null;
          camera_make?: string;
          camera_model?: string;
          orientation?: number | null;
          location_source?: "none" | "exif" | "place" | "manual";
          metadata?: Json;
        };
        Relationships: [];
      };
      couple_notes: {
        Row: {
          id: string;
          couple_id: string;
          kind: "vault" | "gift" | "bucket";
          title: string;
          detail: string;
          status: string;
          extra: string;
          sort_order: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          couple_id: string;
          kind: "vault" | "gift" | "bucket";
          title: string;
          detail?: string;
          status?: string;
          extra?: string;
          sort_order?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          detail?: string;
          status?: string;
          extra?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      my_couple_id: { Args: Record<string, never>; Returns: string | null };
      ensure_own_couple: { Args: Record<string, never>; Returns: string };
      create_couple_invite: { Args: Record<string, never>; Returns: Json };
      accept_couple_invite: { Args: { invite_token: string }; Returns: string };
      get_invite_preview: { Args: { invite_token: string }; Returns: Json };
      save_couple_plan_atomic: {
        Args: {
          target_kind: string;
          target_title: string;
          target_subtitle: string;
          target_start_date: string | null;
          target_day_count: number;
          target_items: Json;
          target_summary: string;
          expected_revision?: number | null;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
