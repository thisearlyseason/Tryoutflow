export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      analytics_outbox_events: {
        Row: {
          correlation_id: string;
          created_at: string;
          event_name: string;
          id: string;
          occurred_at: string;
          organization_id: string;
          payload: Json;
          workflow: string;
        };
        Insert: {
          correlation_id: string;
          created_at?: string;
          event_name: string;
          id?: string;
          occurred_at?: string;
          organization_id: string;
          payload?: Json;
          workflow: string;
        };
        Update: {
          correlation_id?: string;
          created_at?: string;
          event_name?: string;
          id?: string;
          occurred_at?: string;
          organization_id?: string;
          payload?: Json;
          workflow?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'analytics_outbox_events_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      athlete_corrections: {
        Row: {
          athlete_id: string;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          request_text: string;
          response: string;
          status: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          athlete_id: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id: string;
          request_text: string;
          response?: string;
          status?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          athlete_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          request_text?: string;
          response?: string;
          status?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'athlete_corrections_organization_id_athlete_id_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      athlete_flags: {
        Row: {
          created_at: string;
          creator_kind: string;
          creator_user_id: string;
          division_id: string;
          evaluation_id: string | null;
          evaluator_user_id: string | null;
          flag_type: string;
          group_id: string | null;
          id: string;
          organization_id: string;
          revoked_at: string | null;
          tryout_id: string;
          tryout_registration_id: string;
          tryout_session_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          creator_kind: string;
          creator_user_id: string;
          division_id: string;
          evaluation_id?: string | null;
          evaluator_user_id?: string | null;
          flag_type: string;
          group_id?: string | null;
          id?: string;
          organization_id: string;
          revoked_at?: string | null;
          tryout_id: string;
          tryout_registration_id: string;
          tryout_session_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          creator_kind?: string;
          creator_user_id?: string;
          division_id?: string;
          evaluation_id?: string | null;
          evaluator_user_id?: string | null;
          flag_type?: string;
          group_id?: string | null;
          id?: string;
          organization_id?: string;
          revoked_at?: string | null;
          tryout_id?: string;
          tryout_registration_id?: string;
          tryout_session_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'athlete_flags_division_context_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_divisions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'athlete_flags_evaluation_fkey';
            columns: ['organization_id', 'evaluator_user_id', 'evaluation_id'];
            isOneToOne: false;
            referencedRelation: 'evaluations';
            referencedColumns: ['organization_id', 'evaluator_user_id', 'id'];
          },
          {
            foreignKeyName: 'athlete_flags_group_context_fkey';
            columns: [
              'organization_id',
              'tryout_id',
              'division_id',
              'tryout_session_id',
              'group_id',
            ];
            isOneToOne: false;
            referencedRelation: 'session_groups';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'session_id', 'id'];
          },
          {
            foreignKeyName: 'athlete_flags_registration_context_fkey';
            columns: ['organization_id', 'tryout_id', 'tryout_registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'athlete_flags_session_context_fkey';
            columns: [
              'organization_id',
              'tryout_id',
              'tryout_registration_id',
              'tryout_session_id',
            ];
            isOneToOne: false;
            referencedRelation: 'session_enrollments';
            referencedColumns: ['organization_id', 'tryout_id', 'registration_id', 'session_id'];
          },
        ];
      };
      athlete_guardians: {
        Row: {
          athlete_id: string;
          communication_permitted: boolean;
          created_at: string;
          guardian_id: string;
          is_primary_contact: boolean;
          organization_id: string;
          relationship_label: string;
        };
        Insert: {
          athlete_id: string;
          communication_permitted?: boolean;
          created_at?: string;
          guardian_id: string;
          is_primary_contact?: boolean;
          organization_id: string;
          relationship_label?: string;
        };
        Update: {
          athlete_id?: string;
          communication_permitted?: boolean;
          created_at?: string;
          guardian_id?: string;
          is_primary_contact?: boolean;
          organization_id?: string;
          relationship_label?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'athlete_guardians_athlete_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'athlete_guardians_guardian_fkey';
            columns: ['organization_id', 'guardian_id'];
            isOneToOne: false;
            referencedRelation: 'guardians';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      athlete_import_previews: {
        Row: {
          actor_user_id: string;
          column_mapping: Json;
          committed_at: string | null;
          created_at: string;
          duplicate_decisions: Json;
          expires_at: string;
          id: string;
          organization_id: string;
          preview_rows: Json;
          result_athlete_ids: string[] | null;
          selection_digest: string | null;
          source_digest: string;
        };
        Insert: {
          actor_user_id: string;
          column_mapping: Json;
          committed_at?: string | null;
          created_at?: string;
          duplicate_decisions?: Json;
          expires_at: string;
          id?: string;
          organization_id: string;
          preview_rows: Json;
          result_athlete_ids?: string[] | null;
          selection_digest?: string | null;
          source_digest: string;
        };
        Update: {
          actor_user_id?: string;
          column_mapping?: Json;
          committed_at?: string | null;
          created_at?: string;
          duplicate_decisions?: Json;
          expires_at?: string;
          id?: string;
          organization_id?: string;
          preview_rows?: Json;
          result_athlete_ids?: string[] | null;
          selection_digest?: string | null;
          source_digest?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'athlete_import_previews_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      athlete_sport_profiles: {
        Row: {
          athlete_id: string;
          biography: string;
          competitive_level: string;
          created_at: string;
          created_by: string;
          current_team: string;
          dominant_side: string;
          hometown: string;
          id: string;
          organization_id: string;
          preferred_name: string;
          primary_position: string;
          secondary_positions: string;
          sport: string;
          stage: string;
          tags: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          athlete_id: string;
          biography?: string;
          competitive_level?: string;
          created_at?: string;
          created_by?: string;
          current_team?: string;
          dominant_side?: string;
          hometown?: string;
          id?: string;
          organization_id: string;
          preferred_name?: string;
          primary_position?: string;
          secondary_positions?: string;
          sport?: string;
          stage?: string;
          tags?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          athlete_id?: string;
          biography?: string;
          competitive_level?: string;
          created_at?: string;
          created_by?: string;
          current_team?: string;
          dominant_side?: string;
          hometown?: string;
          id?: string;
          organization_id?: string;
          preferred_name?: string;
          primary_position?: string;
          secondary_positions?: string;
          sport?: string;
          stage?: string;
          tags?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'athlete_sport_profiles_organization_id_athlete_id_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: true;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      athletes: {
        Row: {
          birth_date: string | null;
          created_at: string;
          family_name: string;
          given_name: string;
          id: string;
          normalized_family_name: string;
          normalized_given_name: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          birth_date?: string | null;
          created_at?: string;
          family_name: string;
          given_name: string;
          id?: string;
          normalized_family_name: string;
          normalized_given_name: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          birth_date?: string | null;
          created_at?: string;
          family_name?: string;
          given_name?: string;
          id?: string;
          normalized_family_name?: string;
          normalized_given_name?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'athletes_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_user_id: string | null;
          details: Json;
          entity_id: string;
          entity_type: string;
          id: string;
          occurred_at: string;
          organization_id: string;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          details?: Json;
          entity_id: string;
          entity_type: string;
          id?: string;
          occurred_at?: string;
          organization_id: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          details?: Json;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          occurred_at?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      billing_audit_log: {
        Row: {
          actor_id: string | null;
          created_at: string;
          event_type: string;
          id: number;
          metadata: Json;
          organization_id: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          event_type: string;
          id?: never;
          metadata?: Json;
          organization_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: never;
          metadata?: Json;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'billing_audit_log_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      billing_contracts: {
        Row: {
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string;
          downgrade_effective_at: string | null;
          environment: string;
          grace_period_end: string | null;
          id: string;
          observed_at: string;
          organization_id: string;
          pending_product_key: string | null;
          product_key: string;
          provider: string;
          provider_contract_id: string;
          provider_customer_id: string;
          purchaser_id: string;
          status: string;
          tryout_id: string | null;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start: string;
          downgrade_effective_at?: string | null;
          environment: string;
          grace_period_end?: string | null;
          id?: string;
          observed_at: string;
          organization_id: string;
          pending_product_key?: string | null;
          product_key: string;
          provider: string;
          provider_contract_id: string;
          provider_customer_id: string;
          purchaser_id: string;
          status: string;
          tryout_id?: string | null;
        };
        Update: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string;
          downgrade_effective_at?: string | null;
          environment?: string;
          grace_period_end?: string | null;
          id?: string;
          observed_at?: string;
          organization_id?: string;
          pending_product_key?: string | null;
          product_key?: string;
          provider?: string;
          provider_contract_id?: string;
          provider_customer_id?: string;
          purchaser_id?: string;
          status?: string;
          tryout_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'billing_contracts_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'billing_contracts_organization_id_tryout_id_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'billing_contracts_pending_product_key_fkey';
            columns: ['pending_product_key'];
            isOneToOne: false;
            referencedRelation: 'billing_products';
            referencedColumns: ['key'];
          },
          {
            foreignKeyName: 'billing_contracts_product_key_fkey';
            columns: ['product_key'];
            isOneToOne: false;
            referencedRelation: 'billing_products';
            referencedColumns: ['key'];
          },
        ];
      };
      billing_deliveries: {
        Row: {
          attempts: number;
          event_type: string;
          last_received_at: string;
          payload_digest: string;
          processed_at: string | null;
          processing_error: string | null;
          processing_status: string;
          provider: string;
          provider_event_id: string;
        };
        Insert: {
          attempts?: number;
          event_type: string;
          last_received_at?: string;
          payload_digest: string;
          processed_at?: string | null;
          processing_error?: string | null;
          processing_status: string;
          provider: string;
          provider_event_id: string;
        };
        Update: {
          attempts?: number;
          event_type?: string;
          last_received_at?: string;
          payload_digest?: string;
          processed_at?: string | null;
          processing_error?: string | null;
          processing_status?: string;
          provider?: string;
          provider_event_id?: string;
        };
        Relationships: [];
      };
      billing_events: {
        Row: {
          contract_id: string | null;
          event_type: string;
          id: number;
          occurred_at: string;
          organization_id: string | null;
          payload_digest: string;
          payload_metadata: Json;
          processed_at: string;
          processing_status: string;
          provider: string;
          provider_event_id: string;
        };
        Insert: {
          contract_id?: string | null;
          event_type: string;
          id?: never;
          occurred_at: string;
          organization_id?: string | null;
          payload_digest: string;
          payload_metadata?: Json;
          processed_at?: string;
          processing_status: string;
          provider: string;
          provider_event_id: string;
        };
        Update: {
          contract_id?: string | null;
          event_type?: string;
          id?: never;
          occurred_at?: string;
          organization_id?: string | null;
          payload_digest?: string;
          payload_metadata?: Json;
          processed_at?: string;
          processing_status?: string;
          provider?: string;
          provider_event_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'billing_events_contract_id_fkey';
            columns: ['contract_id'];
            isOneToOne: false;
            referencedRelation: 'billing_contracts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'billing_events_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      billing_overrides: {
        Row: {
          created_at: string;
          expires_at: string;
          granted_by: string | null;
          id: string;
          organization_id: string;
          product_key: string;
          reason: string;
          revoked_at: string | null;
          starts_at: string;
          tryout_id: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          granted_by?: string | null;
          id?: string;
          organization_id: string;
          product_key: string;
          reason: string;
          revoked_at?: string | null;
          starts_at: string;
          tryout_id?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          granted_by?: string | null;
          id?: string;
          organization_id?: string;
          product_key?: string;
          reason?: string;
          revoked_at?: string | null;
          starts_at?: string;
          tryout_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'billing_overrides_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'billing_overrides_organization_id_tryout_id_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'billing_overrides_product_key_fkey';
            columns: ['product_key'];
            isOneToOne: false;
            referencedRelation: 'billing_products';
            referencedColumns: ['key'];
          },
        ];
      };
      billing_products: {
        Row: {
          features: string[];
          interval: string | null;
          key: string;
          kind: string;
          limits: Json;
          name: string;
          tier: string;
        };
        Insert: {
          features: string[];
          interval?: string | null;
          key: string;
          kind: string;
          limits?: Json;
          name: string;
          tier: string;
        };
        Update: {
          features?: string[];
          interval?: string | null;
          key?: string;
          kind?: string;
          limits?: Json;
          name?: string;
          tier?: string;
        };
        Relationships: [];
      };
      calibration_attempts: {
        Row: {
          case_id: string;
          created_at: string;
          id: string;
          organization_id: string;
          rationale: string;
          score: number;
          user_id: string;
        };
        Insert: {
          case_id: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          rationale: string;
          score: number;
          user_id?: string;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          rationale?: string;
          score?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'calibration_attempts_organization_id_case_id_fkey';
            columns: ['organization_id', 'case_id'];
            isOneToOne: false;
            referencedRelation: 'calibration_cases';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'calibration_attempts_organization_id_user_id_fkey';
            columns: ['organization_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
        ];
      };
      calibration_cases: {
        Row: {
          active: boolean;
          anchor_explanation: string;
          anchor_score: number;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          prompt: string;
          rubric_guidance: string;
          title: string;
        };
        Insert: {
          active?: boolean;
          anchor_explanation: string;
          anchor_score: number;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id: string;
          prompt: string;
          rubric_guidance: string;
          title: string;
        };
        Update: {
          active?: boolean;
          anchor_explanation?: string;
          anchor_score?: number;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          prompt?: string;
          rubric_guidance?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'calibration_cases_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      checkin_qr_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          organization_id: string;
          registration_id: string;
          revoked_at: string | null;
          token_digest: string;
          tryout_id: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          organization_id: string;
          registration_id: string;
          revoked_at?: string | null;
          token_digest: string;
          tryout_id: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          organization_id?: string;
          registration_id?: string;
          revoked_at?: string | null;
          token_digest?: string;
          tryout_id?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'checkin_qr_registration_fkey';
            columns: ['organization_id', 'tryout_id', 'registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      checkin_search_rate_counters: {
        Row: {
          actor_user_id: string;
          attempts: number;
          expires_at: string;
          organization_id: string;
          rate_key_hash: string;
          tryout_id: string;
          window_started_at: string;
        };
        Insert: {
          actor_user_id: string;
          attempts: number;
          expires_at: string;
          organization_id: string;
          rate_key_hash: string;
          tryout_id: string;
          window_started_at: string;
        };
        Update: {
          actor_user_id?: string;
          attempts?: number;
          expires_at?: string;
          organization_id?: string;
          rate_key_hash?: string;
          tryout_id?: string;
          window_started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'checkin_search_rate_counters_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checkin_search_rate_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      checkins: {
        Row: {
          assigned_number_snapshot: number;
          checked_in_at: string;
          checked_in_by_user_id: string;
          group_id: string | null;
          id: string;
          idempotency_key_digest: string;
          initial_outcome: string;
          organization_id: string;
          registration_id: string;
          request_payload_digest: string;
          reversed_at: string | null;
          session_id: string;
          tryout_id: string;
          tryout_number_id: string;
        };
        Insert: {
          assigned_number_snapshot: number;
          checked_in_at?: string;
          checked_in_by_user_id: string;
          group_id?: string | null;
          id?: string;
          idempotency_key_digest: string;
          initial_outcome?: string;
          organization_id: string;
          registration_id: string;
          request_payload_digest: string;
          reversed_at?: string | null;
          session_id: string;
          tryout_id: string;
          tryout_number_id: string;
        };
        Update: {
          assigned_number_snapshot?: number;
          checked_in_at?: string;
          checked_in_by_user_id?: string;
          group_id?: string | null;
          id?: string;
          idempotency_key_digest?: string;
          initial_outcome?: string;
          organization_id?: string;
          registration_id?: string;
          request_payload_digest?: string;
          reversed_at?: string | null;
          session_id?: string;
          tryout_id?: string;
          tryout_number_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'checkins_group_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id', 'group_id'];
            isOneToOne: false;
            referencedRelation: 'session_groups';
            referencedColumns: ['organization_id', 'tryout_id', 'session_id', 'id'];
          },
          {
            foreignKeyName: 'checkins_number_fkey';
            columns: ['organization_id', 'tryout_number_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_numbers';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'checkins_number_registration_fkey';
            columns: ['organization_id', 'tryout_id', 'registration_id', 'tryout_number_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_numbers';
            referencedColumns: ['organization_id', 'tryout_id', 'registration_id', 'id'];
          },
          {
            foreignKeyName: 'checkins_registration_fkey';
            columns: ['organization_id', 'tryout_id', 'registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'checkins_session_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      communication_batches: {
        Row: {
          created_at: string;
          created_by_user_id: string;
          decision: string;
          editable_text: string;
          id: string;
          organization_id: string;
          preview_digest: string;
          recipient_count: number;
          roster_version: number;
          roster_version_id: string;
          template_content: string;
          template_id: string;
          template_version: number;
        };
        Insert: {
          created_at?: string;
          created_by_user_id: string;
          decision: string;
          editable_text: string;
          id?: string;
          organization_id: string;
          preview_digest: string;
          recipient_count: number;
          roster_version: number;
          roster_version_id: string;
          template_content: string;
          template_id: string;
          template_version: number;
        };
        Update: {
          created_at?: string;
          created_by_user_id?: string;
          decision?: string;
          editable_text?: string;
          id?: string;
          organization_id?: string;
          preview_digest?: string;
          recipient_count?: number;
          roster_version?: number;
          roster_version_id?: string;
          template_content?: string;
          template_id?: string;
          template_version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'communication_batches_organization_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communication_batches_roster_fkey';
            columns: ['organization_id', 'roster_version_id'];
            isOneToOne: false;
            referencedRelation: 'roster_versions';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      communication_delivery_events: {
        Row: {
          applied_state: string;
          event_id: string;
          event_type: string;
          message_id: string;
          occurred_at: string;
          organization_id: string;
          provider_message_id: string;
          received_at: string;
        };
        Insert: {
          applied_state: string;
          event_id: string;
          event_type: string;
          message_id: string;
          occurred_at: string;
          organization_id: string;
          provider_message_id: string;
          received_at?: string;
        };
        Update: {
          applied_state?: string;
          event_id?: string;
          event_type?: string;
          message_id?: string;
          occurred_at?: string;
          organization_id?: string;
          provider_message_id?: string;
          received_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'communication_delivery_events_message_fkey';
            columns: ['organization_id', 'message_id'];
            isOneToOne: false;
            referencedRelation: 'communication_messages';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      communication_messages: {
        Row: {
          attention_required_at: string | null;
          business_idempotency_key: string;
          cancellation_reason: string | null;
          communication_batch_id: string | null;
          content_snapshot: Json;
          created_at: string;
          delivery_state_at: string | null;
          id: string;
          message_kind: string;
          notice_class: string;
          organization_id: string;
          protected_facts_snapshot: Json;
          provider_message_id: string | null;
          recipient_snapshot: Json;
          request_digest: string;
          source_authorizing_user_id: string | null;
          source_binding_version: number;
          source_confirmation_token_digest: string | null;
          source_division_id: string | null;
          source_expected_decision: string | null;
          source_guardian_id: string | null;
          source_id: string;
          source_invitation_token_digest: string | null;
          source_kind: string;
          source_registration_id: string | null;
          source_roster_version_id: string | null;
          source_template_id: string | null;
          source_template_version: number | null;
          source_tryout_id: string | null;
          state: string;
          submitted_at: string | null;
          updated_at: string;
        };
        Insert: {
          attention_required_at?: string | null;
          business_idempotency_key: string;
          cancellation_reason?: string | null;
          communication_batch_id?: string | null;
          content_snapshot: Json;
          created_at?: string;
          delivery_state_at?: string | null;
          id?: string;
          message_kind: string;
          notice_class: string;
          organization_id: string;
          protected_facts_snapshot?: Json;
          provider_message_id?: string | null;
          recipient_snapshot: Json;
          request_digest: string;
          source_authorizing_user_id?: string | null;
          source_binding_version?: number;
          source_confirmation_token_digest?: string | null;
          source_division_id?: string | null;
          source_expected_decision?: string | null;
          source_guardian_id?: string | null;
          source_id: string;
          source_invitation_token_digest?: string | null;
          source_kind: string;
          source_registration_id?: string | null;
          source_roster_version_id?: string | null;
          source_template_id?: string | null;
          source_template_version?: number | null;
          source_tryout_id?: string | null;
          state?: string;
          submitted_at?: string | null;
          updated_at?: string;
        };
        Update: {
          attention_required_at?: string | null;
          business_idempotency_key?: string;
          cancellation_reason?: string | null;
          communication_batch_id?: string | null;
          content_snapshot?: Json;
          created_at?: string;
          delivery_state_at?: string | null;
          id?: string;
          message_kind?: string;
          notice_class?: string;
          organization_id?: string;
          protected_facts_snapshot?: Json;
          provider_message_id?: string | null;
          recipient_snapshot?: Json;
          request_digest?: string;
          source_authorizing_user_id?: string | null;
          source_binding_version?: number;
          source_confirmation_token_digest?: string | null;
          source_division_id?: string | null;
          source_expected_decision?: string | null;
          source_guardian_id?: string | null;
          source_id?: string;
          source_invitation_token_digest?: string | null;
          source_kind?: string;
          source_registration_id?: string | null;
          source_roster_version_id?: string | null;
          source_template_id?: string | null;
          source_template_version?: number | null;
          source_tryout_id?: string | null;
          state?: string;
          submitted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'communication_messages_batch_fkey';
            columns: ['organization_id', 'communication_batch_id'];
            isOneToOne: false;
            referencedRelation: 'communication_batches';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'communication_messages_batch_template_fkey';
            columns: [
              'organization_id',
              'communication_batch_id',
              'source_template_id',
              'source_template_version',
            ];
            isOneToOne: false;
            referencedRelation: 'communication_batches';
            referencedColumns: ['organization_id', 'id', 'template_id', 'template_version'];
          },
          {
            foreignKeyName: 'communication_messages_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communication_messages_source_division_fkey';
            columns: ['organization_id', 'source_tryout_id', 'source_division_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_divisions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'communication_messages_source_tryout_fkey';
            columns: ['organization_id', 'source_tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      communication_pending_delivery_events: {
        Row: {
          event_id: string;
          event_type: string;
          message_id: string;
          occurred_at: string;
          organization_id: string;
          provider_message_id: string;
          received_at: string;
        };
        Insert: {
          event_id: string;
          event_type: string;
          message_id: string;
          occurred_at: string;
          organization_id: string;
          provider_message_id: string;
          received_at?: string;
        };
        Update: {
          event_id?: string;
          event_type?: string;
          message_id?: string;
          occurred_at?: string;
          organization_id?: string;
          provider_message_id?: string;
          received_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'communication_pending_events_message_fkey';
            columns: ['organization_id', 'message_id'];
            isOneToOne: false;
            referencedRelation: 'communication_messages';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      communication_preview_proofs: {
        Row: {
          actor_user_id: string;
          decision: string;
          division_id: string;
          editable_text: string;
          expires_at: string;
          issued_at: string;
          organization_id: string;
          payload_snapshot: Json;
          recipient_digest: string;
          render_digest: string;
          roster_version: number;
          roster_version_id: string;
          template_content: string;
          template_id: string;
          template_version: number;
          token_digest: string;
          tryout_id: string;
        };
        Insert: {
          actor_user_id: string;
          decision: string;
          division_id: string;
          editable_text: string;
          expires_at: string;
          issued_at?: string;
          organization_id: string;
          payload_snapshot: Json;
          recipient_digest: string;
          render_digest: string;
          roster_version: number;
          roster_version_id: string;
          template_content: string;
          template_id: string;
          template_version: number;
          token_digest: string;
          tryout_id: string;
        };
        Update: {
          actor_user_id?: string;
          decision?: string;
          division_id?: string;
          editable_text?: string;
          expires_at?: string;
          issued_at?: string;
          organization_id?: string;
          payload_snapshot?: Json;
          recipient_digest?: string;
          render_digest?: string;
          roster_version?: number;
          roster_version_id?: string;
          template_content?: string;
          template_id?: string;
          template_version?: number;
          token_digest?: string;
          tryout_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'communication_preview_proofs_org_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communication_preview_proofs_roster_fkey';
            columns: ['organization_id', 'roster_version_id'];
            isOneToOne: false;
            referencedRelation: 'roster_versions';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      communication_preview_tombstones: {
        Row: {
          binding_digest: string;
          communication_batch_id: string;
          consumed_at: string;
          render_digest: string;
          token_digest: string;
        };
        Insert: {
          binding_digest: string;
          communication_batch_id: string;
          consumed_at?: string;
          render_digest: string;
          token_digest: string;
        };
        Update: {
          binding_digest?: string;
          communication_batch_id?: string;
          consumed_at?: string;
          render_digest?: string;
          token_digest?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'communication_preview_tombstones_batch_fkey';
            columns: ['communication_batch_id'];
            isOneToOne: false;
            referencedRelation: 'communication_batches';
            referencedColumns: ['id'];
          },
        ];
      };
      communication_templates: {
        Row: {
          created_at: string;
          editable_text: string;
          id: string;
          message_kind: string;
          organization_id: string;
          updated_at: string;
          updated_by_user_id: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          editable_text: string;
          id?: string;
          message_kind: string;
          organization_id: string;
          updated_at?: string;
          updated_by_user_id: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          editable_text?: string;
          id?: string;
          message_kind?: string;
          organization_id?: string;
          updated_at?: string;
          updated_by_user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'communication_templates_organization_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      decision_history: {
        Row: {
          actor_user_id: string;
          changed_at: string;
          division_id: string;
          from_status: string;
          id: string;
          organization_id: string;
          registration_id: string;
          roster_version_id: string;
          to_status: string;
          tryout_id: string;
        };
        Insert: {
          actor_user_id: string;
          changed_at?: string;
          division_id: string;
          from_status: string;
          id?: string;
          organization_id: string;
          registration_id: string;
          roster_version_id: string;
          to_status: string;
          tryout_id: string;
        };
        Update: {
          actor_user_id?: string;
          changed_at?: string;
          division_id?: string;
          from_status?: string;
          id?: string;
          organization_id?: string;
          registration_id?: string;
          roster_version_id?: string;
          to_status?: string;
          tryout_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'decision_history_decision_fkey';
            columns: ['organization_id', 'roster_version_id', 'registration_id'];
            isOneToOne: false;
            referencedRelation: 'roster_decisions';
            referencedColumns: ['organization_id', 'roster_version_id', 'registration_id'];
          },
          {
            foreignKeyName: 'decision_history_version_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'roster_version_id'];
            isOneToOne: false;
            referencedRelation: 'roster_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
        ];
      };
      eligibility_exceptions: {
        Row: {
          athlete_id: string;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          policy_version: number;
          reason: string;
          status: string;
          tryout_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          athlete_id: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id: string;
          policy_version: number;
          reason: string;
          status: string;
          tryout_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          athlete_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          policy_version?: number;
          reason?: string;
          status?: string;
          tryout_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'eligibility_exceptions_organization_id_athlete_id_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'eligibility_exceptions_organization_id_tryout_id_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'event_eligibility_policies';
            referencedColumns: ['organization_id', 'tryout_id'];
          },
        ];
      };
      evaluation_mutations: {
        Row: {
          actor_user_id: string;
          client_mutation_id: string;
          created_at: string;
          evaluation_id: string;
          expected_version: number;
          organization_id: string;
          outcome: string;
          payload_digest: string;
          receipt: Json;
          server_version: number | null;
        };
        Insert: {
          actor_user_id: string;
          client_mutation_id: string;
          created_at?: string;
          evaluation_id: string;
          expected_version: number;
          organization_id: string;
          outcome: string;
          payload_digest: string;
          receipt: Json;
          server_version?: number | null;
        };
        Update: {
          actor_user_id?: string;
          client_mutation_id?: string;
          created_at?: string;
          evaluation_id?: string;
          expected_version?: number;
          organization_id?: string;
          outcome?: string;
          payload_digest?: string;
          receipt?: Json;
          server_version?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'evaluation_mutations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      evaluation_note_tags: {
        Row: {
          created_at: string;
          evaluation_id: string;
          evaluator_user_id: string;
          note_tag_id: string;
          organization_id: string;
        };
        Insert: {
          created_at?: string;
          evaluation_id: string;
          evaluator_user_id: string;
          note_tag_id: string;
          organization_id: string;
        };
        Update: {
          created_at?: string;
          evaluation_id?: string;
          evaluator_user_id?: string;
          note_tag_id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'evaluation_note_tags_evaluation_fkey';
            columns: ['organization_id', 'evaluator_user_id', 'evaluation_id'];
            isOneToOne: false;
            referencedRelation: 'evaluations';
            referencedColumns: ['organization_id', 'evaluator_user_id', 'id'];
          },
          {
            foreignKeyName: 'evaluation_note_tags_tag_fkey';
            columns: ['organization_id', 'note_tag_id'];
            isOneToOne: false;
            referencedRelation: 'organization_evaluation_note_tags';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      evaluation_notes: {
        Row: {
          created_at: string;
          evaluation_id: string;
          evaluator_user_id: string;
          id: string;
          note: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          evaluation_id: string;
          evaluator_user_id: string;
          id?: string;
          note: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          evaluation_id?: string;
          evaluator_user_id?: string;
          id?: string;
          note?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'evaluation_notes_evaluation_fkey';
            columns: ['organization_id', 'evaluator_user_id', 'evaluation_id'];
            isOneToOne: false;
            referencedRelation: 'evaluations';
            referencedColumns: ['organization_id', 'evaluator_user_id', 'id'];
          },
        ];
      };
      evaluation_scores: {
        Row: {
          created_at: string;
          evaluation_id: string;
          id: string;
          organization_id: string;
          rubric_category_id: string;
          rubric_version_id: string;
          tryout_id: string;
          updated_at: string;
          value: number;
        };
        Insert: {
          created_at?: string;
          evaluation_id: string;
          id?: string;
          organization_id: string;
          rubric_category_id: string;
          rubric_version_id: string;
          tryout_id: string;
          updated_at?: string;
          value: number;
        };
        Update: {
          created_at?: string;
          evaluation_id?: string;
          id?: string;
          organization_id?: string;
          rubric_category_id?: string;
          rubric_version_id?: string;
          tryout_id?: string;
          updated_at?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'evaluation_scores_category_fkey';
            columns: ['organization_id', 'tryout_id', 'rubric_version_id', 'rubric_category_id'];
            isOneToOne: false;
            referencedRelation: 'rubric_categories';
            referencedColumns: ['organization_id', 'tryout_id', 'rubric_version_id', 'id'];
          },
          {
            foreignKeyName: 'evaluation_scores_evaluation_fkey';
            columns: ['organization_id', 'tryout_id', 'rubric_version_id', 'evaluation_id'];
            isOneToOne: false;
            referencedRelation: 'evaluations';
            referencedColumns: ['organization_id', 'tryout_id', 'rubric_version_id', 'id'];
          },
        ];
      };
      evaluations: {
        Row: {
          completed_at: string | null;
          created_at: string;
          division_id: string;
          evaluator_user_id: string;
          group_id: string | null;
          id: string;
          organization_id: string;
          reopen_reason: string | null;
          reopened_at: string | null;
          reopened_by_user_id: string | null;
          rubric_version_id: string;
          state: string;
          tryout_id: string;
          tryout_registration_id: string;
          tryout_session_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          division_id: string;
          evaluator_user_id: string;
          group_id?: string | null;
          id?: string;
          organization_id: string;
          reopen_reason?: string | null;
          reopened_at?: string | null;
          reopened_by_user_id?: string | null;
          rubric_version_id: string;
          state?: string;
          tryout_id: string;
          tryout_registration_id: string;
          tryout_session_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          division_id?: string;
          evaluator_user_id?: string;
          group_id?: string | null;
          id?: string;
          organization_id?: string;
          reopen_reason?: string | null;
          reopened_at?: string | null;
          reopened_by_user_id?: string | null;
          rubric_version_id?: string;
          state?: string;
          tryout_id?: string;
          tryout_registration_id?: string;
          tryout_session_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'evaluations_division_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_divisions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'evaluations_enrollment_fkey';
            columns: [
              'organization_id',
              'tryout_id',
              'tryout_registration_id',
              'tryout_session_id',
            ];
            isOneToOne: false;
            referencedRelation: 'session_enrollments';
            referencedColumns: ['organization_id', 'tryout_id', 'registration_id', 'session_id'];
          },
          {
            foreignKeyName: 'evaluations_group_context_fkey';
            columns: [
              'organization_id',
              'tryout_id',
              'division_id',
              'tryout_session_id',
              'group_id',
            ];
            isOneToOne: false;
            referencedRelation: 'session_groups';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'session_id', 'id'];
          },
          {
            foreignKeyName: 'evaluations_registration_fkey';
            columns: ['organization_id', 'tryout_id', 'tryout_registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'evaluations_rubric_version_fkey';
            columns: ['organization_id', 'tryout_id', 'rubric_version_id'];
            isOneToOne: false;
            referencedRelation: 'rubric_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'evaluations_session_division_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'tryout_session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
        ];
      };
      evaluator_sport_profiles: {
        Row: {
          affiliation: string;
          assignments_acknowledged: boolean;
          availability: string;
          briefing_complete: boolean;
          conflict_disclosure: string;
          created_at: string;
          created_by: string;
          device_check_complete: boolean;
          display_name: string;
          experience: string;
          id: string;
          organization_id: string;
          qualifications: string;
          specialties: string;
          sport: string;
          updated_at: string;
          user_id: string;
          version: number;
        };
        Insert: {
          affiliation?: string;
          assignments_acknowledged?: boolean;
          availability?: string;
          briefing_complete?: boolean;
          conflict_disclosure?: string;
          created_at?: string;
          created_by?: string;
          device_check_complete?: boolean;
          display_name: string;
          experience?: string;
          id?: string;
          organization_id: string;
          qualifications?: string;
          specialties?: string;
          sport?: string;
          updated_at?: string;
          user_id: string;
          version?: number;
        };
        Update: {
          affiliation?: string;
          assignments_acknowledged?: boolean;
          availability?: string;
          briefing_complete?: boolean;
          conflict_disclosure?: string;
          created_at?: string;
          created_by?: string;
          device_check_complete?: boolean;
          display_name?: string;
          experience?: string;
          id?: string;
          organization_id?: string;
          qualifications?: string;
          specialties?: string;
          sport?: string;
          updated_at?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'evaluator_sport_profiles_organization_id_user_id_fkey';
            columns: ['organization_id', 'user_id'];
            isOneToOne: true;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
        ];
      };
      event_eligibility_policies: {
        Row: {
          created_at: string;
          created_by: string;
          cutoff_date: string;
          id: string;
          organization_id: string;
          rules: string;
          tryout_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          cutoff_date: string;
          id?: string;
          organization_id: string;
          rules?: string;
          tryout_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          cutoff_date?: string;
          id?: string;
          organization_id?: string;
          rules?: string;
          tryout_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'event_eligibility_policies_organization_id_tryout_id_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: true;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      event_fees: {
        Row: {
          amount_cents: number;
          athlete_id: string;
          created_at: string;
          created_by: string;
          currency: string;
          description: string;
          due_on: string | null;
          id: string;
          note: string;
          organization_id: string;
          paid_cents: number;
          reference: string;
          refunded_cents: number;
          tryout_id: string;
          updated_at: string;
          version: number;
          waived_cents: number;
        };
        Insert: {
          amount_cents: number;
          athlete_id: string;
          created_at?: string;
          created_by?: string;
          currency: string;
          description: string;
          due_on?: string | null;
          id?: string;
          note?: string;
          organization_id: string;
          paid_cents?: number;
          reference?: string;
          refunded_cents?: number;
          tryout_id: string;
          updated_at?: string;
          version?: number;
          waived_cents?: number;
        };
        Update: {
          amount_cents?: number;
          athlete_id?: string;
          created_at?: string;
          created_by?: string;
          currency?: string;
          description?: string;
          due_on?: string | null;
          id?: string;
          note?: string;
          organization_id?: string;
          paid_cents?: number;
          reference?: string;
          refunded_cents?: number;
          tryout_id?: string;
          updated_at?: string;
          version?: number;
          waived_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'event_fees_organization_id_athlete_id_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'event_fees_organization_id_tryout_id_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      event_notices: {
        Row: {
          body: string;
          category: string;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          status: string;
          title: string;
          tryout_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          body: string;
          category: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id: string;
          status?: string;
          title: string;
          tryout_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          body?: string;
          category?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          status?: string;
          title?: string;
          tryout_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'event_notices_organization_id_tryout_id_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      external_entity_mappings: {
        Row: {
          connection_id: string;
          created_at: string;
          entity_type: string;
          external_id: string;
          external_ref: Json;
          first_sync_job_id: string;
          id: string;
          internal_entity_id: string;
          last_sync_job_id: string;
          organization_id: string;
          provider_key: string;
          updated_at: string;
        };
        Insert: {
          connection_id: string;
          created_at?: string;
          entity_type: string;
          external_id: string;
          external_ref: Json;
          first_sync_job_id: string;
          id?: string;
          internal_entity_id: string;
          last_sync_job_id: string;
          organization_id: string;
          provider_key: string;
          updated_at?: string;
        };
        Update: {
          connection_id?: string;
          created_at?: string;
          entity_type?: string;
          external_id?: string;
          external_ref?: Json;
          first_sync_job_id?: string;
          id?: string;
          internal_entity_id?: string;
          last_sync_job_id?: string;
          organization_id?: string;
          provider_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'external_entity_mappings_connection_fkey';
            columns: ['organization_id', 'connection_id'];
            isOneToOne: false;
            referencedRelation: 'integration_connections';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'external_entity_mappings_first_job_fkey';
            columns: ['organization_id', 'first_sync_job_id'];
            isOneToOne: false;
            referencedRelation: 'integration_sync_jobs';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'external_entity_mappings_last_job_fkey';
            columns: ['organization_id', 'last_sync_job_id'];
            isOneToOne: false;
            referencedRelation: 'integration_sync_jobs';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      guardians: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          name: string | null;
          normalized_email: string;
          organization_id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          name?: string | null;
          normalized_email: string;
          organization_id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          name?: string | null;
          normalized_email?: string;
          organization_id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'guardians_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      integration_connections: {
        Row: {
          connected_at: string;
          created_at: string;
          created_by_user_id: string;
          disconnected_at: string | null;
          display_name: string;
          id: string;
          last_verified_at: string | null;
          mock_data: boolean;
          organization_id: string;
          provider_key: string;
          state: string;
          updated_at: string;
        };
        Insert: {
          connected_at?: string;
          created_at?: string;
          created_by_user_id: string;
          disconnected_at?: string | null;
          display_name: string;
          id: string;
          last_verified_at?: string | null;
          mock_data: boolean;
          organization_id: string;
          provider_key: string;
          state?: string;
          updated_at?: string;
        };
        Update: {
          connected_at?: string;
          created_at?: string;
          created_by_user_id?: string;
          disconnected_at?: string | null;
          display_name?: string;
          id?: string;
          last_verified_at?: string | null;
          mock_data?: boolean;
          organization_id?: string;
          provider_key?: string;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'integration_connections_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      integration_export_previews: {
        Row: {
          approved_fields: string[];
          connection_id: string;
          consumed_at: string | null;
          created_at: string;
          created_by_user_id: string;
          destination_snapshot: Json;
          existing_athlete_ids: string[];
          expires_at: string;
          id: string;
          organization_id: string;
          payload_digest: string;
          preview_snapshot: Json | null;
          provider_confirmation_token: string | null;
          provider_preview_id: string | null;
          provider_snapshot_digest: string | null;
          redacted_at: string | null;
          roster_snapshot: Json;
          roster_version: number;
          roster_version_id: string;
          source_digest: string;
          stage: string;
          sync_job_id: string | null;
        };
        Insert: {
          approved_fields: string[];
          connection_id: string;
          consumed_at?: string | null;
          created_at?: string;
          created_by_user_id: string;
          destination_snapshot: Json;
          existing_athlete_ids?: string[];
          expires_at?: string;
          id?: string;
          organization_id: string;
          payload_digest: string;
          preview_snapshot?: Json | null;
          provider_confirmation_token?: string | null;
          provider_preview_id?: string | null;
          provider_snapshot_digest?: string | null;
          redacted_at?: string | null;
          roster_snapshot: Json;
          roster_version: number;
          roster_version_id: string;
          source_digest: string;
          stage?: string;
          sync_job_id?: string | null;
        };
        Update: {
          approved_fields?: string[];
          connection_id?: string;
          consumed_at?: string | null;
          created_at?: string;
          created_by_user_id?: string;
          destination_snapshot?: Json;
          existing_athlete_ids?: string[];
          expires_at?: string;
          id?: string;
          organization_id?: string;
          payload_digest?: string;
          preview_snapshot?: Json | null;
          provider_confirmation_token?: string | null;
          provider_preview_id?: string | null;
          provider_snapshot_digest?: string | null;
          redacted_at?: string | null;
          roster_snapshot?: Json;
          roster_version?: number;
          roster_version_id?: string;
          source_digest?: string;
          stage?: string;
          sync_job_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'integration_export_previews_connection_fkey';
            columns: ['organization_id', 'connection_id'];
            isOneToOne: false;
            referencedRelation: 'integration_connections';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'integration_export_previews_job_fkey';
            columns: ['organization_id', 'sync_job_id'];
            isOneToOne: false;
            referencedRelation: 'integration_sync_jobs';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'integration_export_previews_roster_fkey';
            columns: ['organization_id', 'roster_version_id'];
            isOneToOne: false;
            referencedRelation: 'roster_versions';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      integration_outbox_jobs: {
        Row: {
          attempt_count: number;
          attempt_number: number;
          available_at: string;
          cancelled_at: string | null;
          completed_at: string | null;
          completion_result_digest: string | null;
          created_at: string;
          dead_lettered_at: string | null;
          id: string;
          item_keys: string[];
          job_type: string;
          last_error_code: string | null;
          lease_expires_at: string | null;
          lease_generation: number;
          lease_owner: string | null;
          lease_token: string | null;
          max_attempts: number;
          organization_id: string;
          payload_version: number;
          provider_idempotency_key: string;
          provider_submission_started_at: string | null;
          request_digest: string;
          retry_idempotency_key: string;
          status: string;
          sync_job_id: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          attempt_number: number;
          available_at?: string;
          cancelled_at?: string | null;
          completed_at?: string | null;
          completion_result_digest?: string | null;
          created_at?: string;
          dead_lettered_at?: string | null;
          id?: string;
          item_keys: string[];
          job_type?: string;
          last_error_code?: string | null;
          lease_expires_at?: string | null;
          lease_generation?: number;
          lease_owner?: string | null;
          lease_token?: string | null;
          max_attempts?: number;
          organization_id: string;
          payload_version?: number;
          provider_idempotency_key: string;
          provider_submission_started_at?: string | null;
          request_digest: string;
          retry_idempotency_key: string;
          status?: string;
          sync_job_id: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          attempt_number?: number;
          available_at?: string;
          cancelled_at?: string | null;
          completed_at?: string | null;
          completion_result_digest?: string | null;
          created_at?: string;
          dead_lettered_at?: string | null;
          id?: string;
          item_keys?: string[];
          job_type?: string;
          last_error_code?: string | null;
          lease_expires_at?: string | null;
          lease_generation?: number;
          lease_owner?: string | null;
          lease_token?: string | null;
          max_attempts?: number;
          organization_id?: string;
          payload_version?: number;
          provider_idempotency_key?: string;
          provider_submission_started_at?: string | null;
          request_digest?: string;
          retry_idempotency_key?: string;
          status?: string;
          sync_job_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'integration_outbox_jobs_job_fkey';
            columns: ['organization_id', 'sync_job_id'];
            isOneToOne: false;
            referencedRelation: 'integration_sync_jobs';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      integration_sync_items: {
        Row: {
          attempts: number;
          completed_at: string | null;
          created_at: string;
          entity_type: string;
          external_ref: Json | null;
          id: string;
          internal_entity_id: string;
          item_key: string;
          normalized_error: Json | null;
          operation: string;
          organization_id: string;
          retry_eligible: boolean;
          state: string;
          sync_job_id: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          entity_type: string;
          external_ref?: Json | null;
          id?: string;
          internal_entity_id: string;
          item_key: string;
          normalized_error?: Json | null;
          operation: string;
          organization_id: string;
          retry_eligible?: boolean;
          state?: string;
          sync_job_id: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          entity_type?: string;
          external_ref?: Json | null;
          id?: string;
          internal_entity_id?: string;
          item_key?: string;
          normalized_error?: Json | null;
          operation?: string;
          organization_id?: string;
          retry_eligible?: boolean;
          state?: string;
          sync_job_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'integration_sync_items_job_fkey';
            columns: ['organization_id', 'sync_job_id'];
            isOneToOne: false;
            referencedRelation: 'integration_sync_jobs';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      integration_sync_jobs: {
        Row: {
          approved_fields: string[];
          approved_projection: Json;
          attention_required_at: string | null;
          business_idempotency_key: string;
          cancelled_at: string | null;
          completed_at: string | null;
          confirmation_token_digest: string | null;
          connection_id: string;
          created_at: string;
          created_by_user_id: string;
          destination_snapshot: Json;
          external_job_id: string | null;
          id: string;
          last_error: Json | null;
          mock_data: boolean;
          operation: string;
          organization_id: string;
          provider_confirmation_token: string | null;
          provider_key: string;
          provider_preview_id: string | null;
          request_digest: string;
          roster_snapshot: Json | null;
          roster_version: number;
          roster_version_id: string;
          source_preview_id: string | null;
          state: string;
          updated_at: string;
        };
        Insert: {
          approved_fields: string[];
          approved_projection?: Json;
          attention_required_at?: string | null;
          business_idempotency_key: string;
          cancelled_at?: string | null;
          completed_at?: string | null;
          confirmation_token_digest?: string | null;
          connection_id: string;
          created_at?: string;
          created_by_user_id: string;
          destination_snapshot: Json;
          external_job_id?: string | null;
          id?: string;
          last_error?: Json | null;
          mock_data: boolean;
          operation?: string;
          organization_id: string;
          provider_confirmation_token?: string | null;
          provider_key: string;
          provider_preview_id?: string | null;
          request_digest: string;
          roster_snapshot?: Json | null;
          roster_version: number;
          roster_version_id: string;
          source_preview_id?: string | null;
          state?: string;
          updated_at?: string;
        };
        Update: {
          approved_fields?: string[];
          approved_projection?: Json;
          attention_required_at?: string | null;
          business_idempotency_key?: string;
          cancelled_at?: string | null;
          completed_at?: string | null;
          confirmation_token_digest?: string | null;
          connection_id?: string;
          created_at?: string;
          created_by_user_id?: string;
          destination_snapshot?: Json;
          external_job_id?: string | null;
          id?: string;
          last_error?: Json | null;
          mock_data?: boolean;
          operation?: string;
          organization_id?: string;
          provider_confirmation_token?: string | null;
          provider_key?: string;
          provider_preview_id?: string | null;
          request_digest?: string;
          roster_snapshot?: Json | null;
          roster_version?: number;
          roster_version_id?: string;
          source_preview_id?: string | null;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'integration_sync_jobs_connection_fkey';
            columns: ['organization_id', 'connection_id'];
            isOneToOne: false;
            referencedRelation: 'integration_connections';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'integration_sync_jobs_roster_fkey';
            columns: ['organization_id', 'roster_version_id'];
            isOneToOne: false;
            referencedRelation: 'roster_versions';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'integration_sync_jobs_source_preview_fkey';
            columns: ['organization_id', 'source_preview_id'];
            isOneToOne: false;
            referencedRelation: 'integration_export_previews';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      notification_preferences: {
        Row: {
          guardian_id: string;
          optional_email_enabled: boolean;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          guardian_id: string;
          optional_email_enabled?: boolean;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          guardian_id?: string;
          optional_email_enabled?: boolean;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_guardian_fkey';
            columns: ['organization_id', 'guardian_id'];
            isOneToOne: true;
            referencedRelation: 'guardians';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'notification_preferences_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_evaluation_note_tags: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          label: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          label: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          label?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_evaluation_note_tags_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by_user_id: string | null;
          created_at: string;
          created_by_user_id: string;
          email: string;
          expires_at: string;
          id: string;
          organization_id: string;
          revoked_at: string | null;
          role: string;
          token_digest: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          created_at?: string;
          created_by_user_id: string;
          email: string;
          expires_at: string;
          id?: string;
          organization_id: string;
          revoked_at?: string | null;
          role?: string;
          token_digest: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          created_at?: string;
          created_by_user_id?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          organization_id?: string;
          revoked_at?: string | null;
          role?: string;
          token_digest?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_invitations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          id: string;
          inherited_from_organization_id: string | null;
          organization_id: string;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          inherited_from_organization_id?: string | null;
          organization_id: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          inherited_from_organization_id?: string | null;
          organization_id?: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_members_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          parent_organization_id: string | null;
          slug: string;
          sport_defaults: Json;
          status: string;
          tag_defaults: Json;
          terminology: Json;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          parent_organization_id?: string | null;
          slug: string;
          sport_defaults?: Json;
          status?: string;
          tag_defaults?: Json;
          terminology?: Json;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          parent_organization_id?: string | null;
          slug?: string;
          sport_defaults?: Json;
          status?: string;
          tag_defaults?: Json;
          terminology?: Json;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organizations_parent_organization_id_fkey';
            columns: ['parent_organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      outbox_jobs: {
        Row: {
          attempt_count: number;
          available_at: string;
          business_idempotency_key: string;
          completed_at: string | null;
          created_at: string;
          dead_lettered_at: string | null;
          delivery_uncertain_at: string | null;
          delivery_uncertain_reason: string | null;
          id: string;
          job_type: string;
          last_error_code: string | null;
          lease_expires_at: string | null;
          lease_generation: number;
          lease_owner: string | null;
          lease_token: string | null;
          legacy_completion_evidence: Json | null;
          max_attempts: number;
          message_id: string;
          organization_id: string;
          payload_version: number;
          provider_idempotency_key: string;
          provider_submission_started_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          available_at?: string;
          business_idempotency_key: string;
          completed_at?: string | null;
          created_at?: string;
          dead_lettered_at?: string | null;
          delivery_uncertain_at?: string | null;
          delivery_uncertain_reason?: string | null;
          id?: string;
          job_type?: string;
          last_error_code?: string | null;
          lease_expires_at?: string | null;
          lease_generation?: number;
          lease_owner?: string | null;
          lease_token?: string | null;
          legacy_completion_evidence?: Json | null;
          max_attempts?: number;
          message_id: string;
          organization_id: string;
          payload_version?: number;
          provider_idempotency_key: string;
          provider_submission_started_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          available_at?: string;
          business_idempotency_key?: string;
          completed_at?: string | null;
          created_at?: string;
          dead_lettered_at?: string | null;
          delivery_uncertain_at?: string | null;
          delivery_uncertain_reason?: string | null;
          id?: string;
          job_type?: string;
          last_error_code?: string | null;
          lease_expires_at?: string | null;
          lease_generation?: number;
          lease_owner?: string | null;
          lease_token?: string | null;
          legacy_completion_evidence?: Json | null;
          max_attempts?: number;
          message_id?: string;
          organization_id?: string;
          payload_version?: number;
          provider_idempotency_key?: string;
          provider_submission_started_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'outbox_jobs_message_fkey';
            columns: ['organization_id', 'message_id'];
            isOneToOne: false;
            referencedRelation: 'communication_messages';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      outbox_provider_handoffs: {
        Row: {
          attempt_state: string;
          job_id: string;
          lease_generation: number;
          lease_token: string;
          message_id: string;
          organization_id: string;
          provider_idempotency_key: string;
          provider_message_id: string | null;
          resolved_at: string | null;
          send_attempt_token: string;
          started_at: string;
        };
        Insert: {
          attempt_state?: string;
          job_id: string;
          lease_generation: number;
          lease_token: string;
          message_id: string;
          organization_id: string;
          provider_idempotency_key: string;
          provider_message_id?: string | null;
          resolved_at?: string | null;
          send_attempt_token?: string;
          started_at?: string;
        };
        Update: {
          attempt_state?: string;
          job_id?: string;
          lease_generation?: number;
          lease_token?: string;
          message_id?: string;
          organization_id?: string;
          provider_idempotency_key?: string;
          provider_message_id?: string | null;
          resolved_at?: string | null;
          send_attempt_token?: string;
          started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'outbox_provider_handoffs_message_fkey';
            columns: ['organization_id', 'message_id'];
            isOneToOne: false;
            referencedRelation: 'communication_messages';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'outbox_provider_handoffs_organization_id_job_id_fkey';
            columns: ['organization_id', 'job_id'];
            isOneToOne: false;
            referencedRelation: 'outbox_jobs';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      participant_links: {
        Row: {
          active: boolean;
          athlete_id: string;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          relationship: string;
          updated_at: string;
          user_id: string;
          version: number;
        };
        Insert: {
          active?: boolean;
          athlete_id: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id: string;
          relationship: string;
          updated_at?: string;
          user_id: string;
          version?: number;
        };
        Update: {
          active?: boolean;
          athlete_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          relationship?: string;
          updated_at?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'participant_links_organization_id_athlete_id_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      performance_metrics: {
        Row: {
          aggregation: string;
          created_at: string;
          created_by: string;
          direction: string;
          id: string;
          maximum: number | null;
          minimum: number | null;
          name: string;
          organization_id: string;
          protocol: string;
          sport: string;
          unit: string;
          updated_at: string;
          value_kind: string;
          version: number;
        };
        Insert: {
          aggregation?: string;
          created_at?: string;
          created_by?: string;
          direction: string;
          id?: string;
          maximum?: number | null;
          minimum?: number | null;
          name: string;
          organization_id: string;
          protocol: string;
          sport: string;
          unit: string;
          updated_at?: string;
          value_kind: string;
          version?: number;
        };
        Update: {
          aggregation?: string;
          created_at?: string;
          created_by?: string;
          direction?: string;
          id?: string;
          maximum?: number | null;
          minimum?: number | null;
          name?: string;
          organization_id?: string;
          protocol?: string;
          sport?: string;
          unit?: string;
          updated_at?: string;
          value_kind?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'performance_metrics_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      performance_results: {
        Row: {
          athlete_id: string;
          created_at: string;
          created_by: string;
          denominator: number | null;
          id: string;
          measured_at: string;
          metric_id: string;
          note: string;
          numerator: number | null;
          organization_id: string;
          session_id: string | null;
          source: string;
          status: string;
          trial: number;
          updated_at: string;
          value: number | null;
          verified: boolean;
          version: number;
        };
        Insert: {
          athlete_id: string;
          created_at?: string;
          created_by?: string;
          denominator?: number | null;
          id?: string;
          measured_at: string;
          metric_id: string;
          note?: string;
          numerator?: number | null;
          organization_id: string;
          session_id?: string | null;
          source: string;
          status: string;
          trial?: number;
          updated_at?: string;
          value?: number | null;
          verified?: boolean;
          version?: number;
        };
        Update: {
          athlete_id?: string;
          created_at?: string;
          created_by?: string;
          denominator?: number | null;
          id?: string;
          measured_at?: string;
          metric_id?: string;
          note?: string;
          numerator?: number | null;
          organization_id?: string;
          session_id?: string | null;
          source?: string;
          status?: string;
          trial?: number;
          updated_at?: string;
          value?: number | null;
          verified?: boolean;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'performance_results_organization_id_athlete_id_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'performance_results_organization_id_metric_id_fkey';
            columns: ['organization_id', 'metric_id'];
            isOneToOne: false;
            referencedRelation: 'performance_metrics';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'performance_results_organization_id_session_id_fkey';
            columns: ['organization_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      platform_administrators: {
        Row: {
          created_at: string;
          disabled_at: string | null;
          granted_by_user_id: string;
          status: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          disabled_at?: string | null;
          granted_by_user_id: string;
          status?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          disabled_at?: string | null;
          granted_by_user_id?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      platform_support_elevations: {
        Row: {
          audit_log_id: string;
          created_at: string;
          expires_at: string;
          granted_by_user_id: string;
          id: string;
          organization_id: string;
          reason: string;
          revoked_at: string | null;
          support_user_id: string;
        };
        Insert: {
          audit_log_id: string;
          created_at?: string;
          expires_at: string;
          granted_by_user_id: string;
          id?: string;
          organization_id: string;
          reason: string;
          revoked_at?: string | null;
          support_user_id: string;
        };
        Update: {
          audit_log_id?: string;
          created_at?: string;
          expires_at?: string;
          granted_by_user_id?: string;
          id?: string;
          organization_id?: string;
          reason?: string;
          revoked_at?: string | null;
          support_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_support_elevations_audit_log_fkey';
            columns: ['organization_id', 'audit_log_id'];
            isOneToOne: false;
            referencedRelation: 'audit_logs';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'platform_support_elevations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      registration_confirmation_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          organization_id: string;
          purpose: string;
          registration_id: string;
          revoked_at: string | null;
          token_digest: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          organization_id: string;
          purpose?: string;
          registration_id: string;
          revoked_at?: string | null;
          token_digest: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          organization_id?: string;
          purpose?: string;
          registration_id?: string;
          revoked_at?: string | null;
          token_digest?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'registration_confirmation_tokens_registration_fkey';
            columns: ['organization_id', 'registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      registration_duplicate_candidates: {
        Row: {
          candidate_athlete_id: string;
          created_at: string;
          id: string;
          organization_id: string;
          reason: string;
          registration_id: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by_user_id: string | null;
        };
        Insert: {
          candidate_athlete_id: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          reason: string;
          registration_id: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by_user_id?: string | null;
        };
        Update: {
          candidate_athlete_id?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          reason?: string;
          registration_id?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'registration_duplicate_candidates_athlete_fkey';
            columns: ['organization_id', 'candidate_athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'registration_duplicate_candidates_registration_fkey';
            columns: ['organization_id', 'registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      registration_form_versions: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          published_at: string | null;
          registration_form_id: string;
          schema: Json;
          status: string;
          tryout_id: string;
          updated_at: string;
          version_number: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          published_at?: string | null;
          registration_form_id: string;
          schema: Json;
          status?: string;
          tryout_id: string;
          updated_at?: string;
          version_number: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          published_at?: string | null;
          registration_form_id?: string;
          schema?: Json;
          status?: string;
          tryout_id?: string;
          updated_at?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'registration_form_versions_form_fkey';
            columns: ['organization_id', 'tryout_id', 'registration_form_id'];
            isOneToOne: false;
            referencedRelation: 'registration_forms';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      registration_forms: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          organization_id: string;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          organization_id?: string;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'registration_forms_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      registration_rate_counters: {
        Row: {
          attempts: number;
          created_at: string;
          expires_at: string;
          key_hash: string;
          updated_at: string;
          window_started_at: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          expires_at: string;
          key_hash: string;
          updated_at?: string;
          window_started_at: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          expires_at?: string;
          key_hash?: string;
          updated_at?: string;
          window_started_at?: string;
        };
        Relationships: [];
      };
      roster_assignments: {
        Row: {
          assigned_at: string;
          assigned_by_user_id: string;
          division_id: string;
          organization_id: string;
          registration_id: string;
          roster_version_id: string;
          team_id: string;
          tryout_id: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by_user_id: string;
          division_id: string;
          organization_id: string;
          registration_id: string;
          roster_version_id: string;
          team_id: string;
          tryout_id: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by_user_id?: string;
          division_id?: string;
          organization_id?: string;
          registration_id?: string;
          roster_version_id?: string;
          team_id?: string;
          tryout_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'roster_assignments_registration_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
          {
            foreignKeyName: 'roster_assignments_snapshot_member_fkey';
            columns: ['organization_id', 'roster_version_id', 'registration_id'];
            isOneToOne: true;
            referencedRelation: 'roster_decisions';
            referencedColumns: ['organization_id', 'roster_version_id', 'registration_id'];
          },
          {
            foreignKeyName: 'roster_assignments_team_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'team_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_teams';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
          {
            foreignKeyName: 'roster_assignments_version_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'roster_version_id'];
            isOneToOne: false;
            referencedRelation: 'roster_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
        ];
      };
      roster_decisions: {
        Row: {
          changed_at: string | null;
          changed_by_user_id: string | null;
          division_id: string;
          organization_id: string;
          registration_id: string;
          roster_version_id: string;
          status: string;
          tryout_id: string;
        };
        Insert: {
          changed_at?: string | null;
          changed_by_user_id?: string | null;
          division_id: string;
          organization_id: string;
          registration_id: string;
          roster_version_id: string;
          status?: string;
          tryout_id: string;
        };
        Update: {
          changed_at?: string | null;
          changed_by_user_id?: string | null;
          division_id?: string;
          organization_id?: string;
          registration_id?: string;
          roster_version_id?: string;
          status?: string;
          tryout_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'roster_decisions_registration_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
          {
            foreignKeyName: 'roster_decisions_version_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'roster_version_id'];
            isOneToOne: false;
            referencedRelation: 'roster_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
        ];
      };
      roster_scenario_members: {
        Row: {
          athlete_id: string;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          rationale: string;
          response: string;
          response_due: string | null;
          role: string;
          scenario_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          athlete_id: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id: string;
          rationale?: string;
          response?: string;
          response_due?: string | null;
          role?: string;
          scenario_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          athlete_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          rationale?: string;
          response?: string;
          response_due?: string | null;
          role?: string;
          scenario_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'roster_scenario_members_organization_id_athlete_id_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'roster_scenario_members_organization_id_scenario_id_fkey';
            columns: ['organization_id', 'scenario_id'];
            isOneToOne: false;
            referencedRelation: 'roster_scenarios';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      roster_scenarios: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          organization_id: string;
          rationale: string;
          status: string;
          target_size: number;
          tryout_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name: string;
          organization_id: string;
          rationale?: string;
          status?: string;
          target_size?: number;
          tryout_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          organization_id?: string;
          rationale?: string;
          status?: string;
          target_size?: number;
          tryout_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'roster_scenarios_organization_id_tryout_id_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      roster_versions: {
        Row: {
          based_on_roster_version_id: string | null;
          created_at: string;
          created_by_user_id: string;
          division_id: string;
          finalized_at: string | null;
          finalized_by_user_id: string | null;
          id: string;
          organization_id: string;
          revision_number: number;
          revision_reason: string | null;
          state: string;
          tryout_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          based_on_roster_version_id?: string | null;
          created_at?: string;
          created_by_user_id: string;
          division_id: string;
          finalized_at?: string | null;
          finalized_by_user_id?: string | null;
          id?: string;
          organization_id: string;
          revision_number: number;
          revision_reason?: string | null;
          state?: string;
          tryout_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          based_on_roster_version_id?: string | null;
          created_at?: string;
          created_by_user_id?: string;
          division_id?: string;
          finalized_at?: string | null;
          finalized_by_user_id?: string | null;
          id?: string;
          organization_id?: string;
          revision_number?: number;
          revision_reason?: string | null;
          state?: string;
          tryout_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'roster_versions_division_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_divisions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'roster_versions_source_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'based_on_roster_version_id'];
            isOneToOne: false;
            referencedRelation: 'roster_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
        ];
      };
      rubric_categories: {
        Row: {
          created_at: string;
          description: string | null;
          guidance: string | null;
          id: string;
          is_priority: boolean;
          name: string;
          organization_id: string;
          rubric_version_id: string;
          scale_max: number;
          scale_min: number;
          sort_order: number;
          tryout_id: string;
          updated_at: string;
          weight: number;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          guidance?: string | null;
          id?: string;
          is_priority?: boolean;
          name: string;
          organization_id: string;
          rubric_version_id: string;
          scale_max: number;
          scale_min: number;
          sort_order: number;
          tryout_id: string;
          updated_at?: string;
          weight: number;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          guidance?: string | null;
          id?: string;
          is_priority?: boolean;
          name?: string;
          organization_id?: string;
          rubric_version_id?: string;
          scale_max?: number;
          scale_min?: number;
          sort_order?: number;
          tryout_id?: string;
          updated_at?: string;
          weight?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'rubric_categories_version_fkey';
            columns: ['organization_id', 'tryout_id', 'rubric_version_id'];
            isOneToOne: false;
            referencedRelation: 'rubric_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      rubric_versions: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          published_at: string | null;
          rubric_id: string;
          status: string;
          tryout_id: string;
          updated_at: string;
          version_number: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          published_at?: string | null;
          rubric_id: string;
          status?: string;
          tryout_id: string;
          updated_at?: string;
          version_number: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          published_at?: string | null;
          rubric_id?: string;
          status?: string;
          tryout_id?: string;
          updated_at?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'rubric_versions_rubric_fkey';
            columns: ['organization_id', 'tryout_id', 'rubric_id'];
            isOneToOne: false;
            referencedRelation: 'rubrics';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      rubrics: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          organization_id: string;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          organization_id?: string;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rubrics_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      scouting_grants: {
        Row: {
          created_at: string;
          organization_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          organization_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          organization_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scouting_grants_organization_id_user_id_fkey';
            columns: ['organization_id', 'user_id'];
            isOneToOne: true;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
        ];
      };
      scouting_records: {
        Row: {
          assigned_user_id: string | null;
          athlete_id: string;
          body: string;
          created_at: string;
          created_by: string;
          criterion: string;
          development_areas: string;
          due_on: string | null;
          end_seconds: number | null;
          event_context: string;
          id: string;
          kind: string;
          observation_type: string;
          observed_at: string | null;
          organization_id: string;
          recommendation: string;
          review_feedback: string;
          source: string;
          start_seconds: number | null;
          status: string;
          strengths: string;
          title: string;
          updated_at: string;
          version: number;
          video_url: string | null;
          visibility: string;
        };
        Insert: {
          assigned_user_id?: string | null;
          athlete_id: string;
          body?: string;
          created_at?: string;
          created_by?: string;
          criterion?: string;
          development_areas?: string;
          due_on?: string | null;
          end_seconds?: number | null;
          event_context?: string;
          id?: string;
          kind: string;
          observation_type?: string;
          observed_at?: string | null;
          organization_id: string;
          recommendation?: string;
          review_feedback?: string;
          source?: string;
          start_seconds?: number | null;
          status?: string;
          strengths?: string;
          title: string;
          updated_at?: string;
          version?: number;
          video_url?: string | null;
          visibility?: string;
        };
        Update: {
          assigned_user_id?: string | null;
          athlete_id?: string;
          body?: string;
          created_at?: string;
          created_by?: string;
          criterion?: string;
          development_areas?: string;
          due_on?: string | null;
          end_seconds?: number | null;
          event_context?: string;
          id?: string;
          kind?: string;
          observation_type?: string;
          observed_at?: string | null;
          organization_id?: string;
          recommendation?: string;
          review_feedback?: string;
          source?: string;
          start_seconds?: number | null;
          status?: string;
          strengths?: string;
          title?: string;
          updated_at?: string;
          version?: number;
          video_url?: string | null;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scouting_records_organization_id_assigned_user_id_fkey';
            columns: ['organization_id', 'assigned_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'scouting_records_organization_id_athlete_id_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      seasons: {
        Row: {
          created_at: string;
          ends_on: string | null;
          id: string;
          name: string;
          organization_id: string;
          starts_on: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ends_on?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          starts_on?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          starts_on?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'seasons_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      session_enrollments: {
        Row: {
          created_at: string;
          group_id: string | null;
          id: string;
          organization_id: string;
          registration_id: string;
          session_id: string;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          group_id?: string | null;
          id?: string;
          organization_id: string;
          registration_id: string;
          session_id: string;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          group_id?: string | null;
          id?: string;
          organization_id?: string;
          registration_id?: string;
          session_id?: string;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_enrollments_group_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id', 'group_id'];
            isOneToOne: false;
            referencedRelation: 'session_groups';
            referencedColumns: ['organization_id', 'tryout_id', 'session_id', 'id'];
          },
          {
            foreignKeyName: 'session_enrollments_registration_tryout_fkey';
            columns: ['organization_id', 'tryout_id', 'registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'session_enrollments_session_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      session_groups: {
        Row: {
          capacity: number | null;
          created_at: string;
          division_id: string;
          id: string;
          name: string;
          organization_id: string;
          session_id: string;
          sort_order: number;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          capacity?: number | null;
          created_at?: string;
          division_id: string;
          id?: string;
          name: string;
          organization_id: string;
          session_id: string;
          sort_order: number;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          capacity?: number | null;
          created_at?: string;
          division_id?: string;
          id?: string;
          name?: string;
          organization_id?: string;
          session_id?: string;
          sort_order?: number;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_groups_division_session_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
          {
            foreignKeyName: 'session_groups_session_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      session_rubrics: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          rubric_version_id: string;
          session_id: string;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          rubric_version_id: string;
          session_id: string;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          rubric_version_id?: string;
          session_id?: string;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_rubrics_session_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'session_rubrics_version_fkey';
            columns: ['organization_id', 'tryout_id', 'rubric_version_id'];
            isOneToOne: false;
            referencedRelation: 'rubric_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      subscription_accounts: {
        Row: {
          cancel_at: string | null;
          cancel_at_period_end: boolean | null;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          entitlement_source: string;
          id: string;
          last_provider_event_created_at: string | null;
          last_provider_event_id: string | null;
          last_provider_event_precedence: number | null;
          organization_id: string;
          plan_key: string | null;
          provider_customer_id: string | null;
          provider_price_id: string | null;
          provider_subscription_id: string | null;
          state: string;
          trial_end: string | null;
          updated_at: string;
          verified_at: string;
          version: number;
        };
        Insert: {
          cancel_at?: string | null;
          cancel_at_period_end?: boolean | null;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          entitlement_source: string;
          id?: string;
          last_provider_event_created_at?: string | null;
          last_provider_event_id?: string | null;
          last_provider_event_precedence?: number | null;
          organization_id: string;
          plan_key?: string | null;
          provider_customer_id?: string | null;
          provider_price_id?: string | null;
          provider_subscription_id?: string | null;
          state: string;
          trial_end?: string | null;
          updated_at?: string;
          verified_at: string;
          version?: number;
        };
        Update: {
          cancel_at?: string | null;
          cancel_at_period_end?: boolean | null;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          entitlement_source?: string;
          id?: string;
          last_provider_event_created_at?: string | null;
          last_provider_event_id?: string | null;
          last_provider_event_precedence?: number | null;
          organization_id?: string;
          plan_key?: string | null;
          provider_customer_id?: string | null;
          provider_price_id?: string | null;
          provider_subscription_id?: string | null;
          state?: string;
          trial_end?: string | null;
          updated_at?: string;
          verified_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_accounts_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      subscription_checkout_intents: {
        Row: {
          client_attempt_id: string;
          completed_at: string | null;
          created_at: string;
          expires_at: string;
          idempotency_key: string;
          initiating_owner_user_id: string | null;
          organization_id: string;
          plan_key: string;
          provider_session_id: string | null;
          result_url: string | null;
          state: string;
        };
        Insert: {
          client_attempt_id: string;
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          idempotency_key: string;
          initiating_owner_user_id?: string | null;
          organization_id: string;
          plan_key: string;
          provider_session_id?: string | null;
          result_url?: string | null;
          state?: string;
        };
        Update: {
          client_attempt_id?: string;
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          idempotency_key?: string;
          initiating_owner_user_id?: string | null;
          organization_id?: string;
          plan_key?: string;
          provider_session_id?: string | null;
          result_url?: string | null;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_checkout_intents_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      subscription_events: {
        Row: {
          cancel_at: string | null;
          cancel_at_period_end: boolean | null;
          canceled_at: string | null;
          claimed_organization_id: string | null;
          current_period_end: string | null;
          current_period_start: string | null;
          event_precedence: number;
          event_type: string;
          organization_id: string | null;
          outcome: string;
          payload: Json;
          payload_digest: string;
          processed_at: string | null;
          provider_created_at: string;
          provider_customer_id: string | null;
          provider_event_id: string;
          provider_price_id: string | null;
          provider_subscription_id: string | null;
          received_at: string;
          trial_end: string | null;
        };
        Insert: {
          cancel_at?: string | null;
          cancel_at_period_end?: boolean | null;
          canceled_at?: string | null;
          claimed_organization_id?: string | null;
          current_period_end?: string | null;
          current_period_start?: string | null;
          event_precedence: number;
          event_type: string;
          organization_id?: string | null;
          outcome?: string;
          payload: Json;
          payload_digest: string;
          processed_at?: string | null;
          provider_created_at: string;
          provider_customer_id?: string | null;
          provider_event_id: string;
          provider_price_id?: string | null;
          provider_subscription_id?: string | null;
          received_at?: string;
          trial_end?: string | null;
        };
        Update: {
          cancel_at?: string | null;
          cancel_at_period_end?: boolean | null;
          canceled_at?: string | null;
          claimed_organization_id?: string | null;
          current_period_end?: string | null;
          current_period_start?: string | null;
          event_precedence?: number;
          event_type?: string;
          organization_id?: string | null;
          outcome?: string;
          payload?: Json;
          payload_digest?: string;
          processed_at?: string | null;
          provider_created_at?: string;
          provider_customer_id?: string | null;
          provider_event_id?: string;
          provider_price_id?: string | null;
          provider_subscription_id?: string | null;
          received_at?: string;
          trial_end?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_events_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      tryout_divisions: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          max_age: number | null;
          min_age: number | null;
          name: string;
          organization_id: string;
          sort_order: number;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          max_age?: number | null;
          min_age?: number | null;
          name: string;
          organization_id: string;
          sort_order: number;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          max_age?: number | null;
          min_age?: number | null;
          name?: string;
          organization_id?: string;
          sort_order?: number;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_divisions_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      tryout_numbers: {
        Row: {
          assigned_at: string;
          assigned_by_user_id: string;
          division_id: string;
          group_id: string | null;
          id: string;
          number: number;
          organization_id: string;
          registration_id: string;
          released_at: string | null;
          scope_kind: string;
          session_id: string | null;
          tryout_id: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by_user_id: string;
          division_id: string;
          group_id?: string | null;
          id?: string;
          number: number;
          organization_id: string;
          registration_id: string;
          released_at?: string | null;
          scope_kind: string;
          session_id?: string | null;
          tryout_id: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by_user_id?: string;
          division_id?: string;
          group_id?: string | null;
          id?: string;
          number?: number;
          organization_id?: string;
          registration_id?: string;
          released_at?: string | null;
          scope_kind?: string;
          session_id?: string | null;
          tryout_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_numbers_division_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_divisions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_numbers_division_group_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'session_id', 'group_id'];
            isOneToOne: false;
            referencedRelation: 'session_groups';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'session_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_numbers_division_session_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'division_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_numbers_group_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id', 'group_id'];
            isOneToOne: false;
            referencedRelation: 'session_groups';
            referencedColumns: ['organization_id', 'tryout_id', 'session_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_numbers_registration_fkey';
            columns: ['organization_id', 'tryout_id', 'registration_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_registrations';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_numbers_session_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      tryout_positions: {
        Row: {
          code: string | null;
          created_at: string;
          id: string;
          is_preset: boolean;
          name: string;
          organization_id: string;
          sort_order: number;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          code?: string | null;
          created_at?: string;
          id?: string;
          is_preset?: boolean;
          name: string;
          organization_id: string;
          sort_order: number;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          code?: string | null;
          created_at?: string;
          id?: string;
          is_preset?: boolean;
          name?: string;
          organization_id?: string;
          sort_order?: number;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_positions_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      tryout_publications: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          registration_form_version_id: string;
          tryout_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          registration_form_version_id: string;
          tryout_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          registration_form_version_id?: string;
          tryout_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_publications_form_version_fkey';
            columns: ['organization_id', 'tryout_id', 'registration_form_version_id'];
            isOneToOne: false;
            referencedRelation: 'registration_form_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_publications_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: true;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      tryout_registration_form_selections: {
        Row: {
          organization_id: string;
          registration_form_version_id: string;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          registration_form_version_id: string;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          registration_form_version_id?: string;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_registration_form_selections_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: true;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_registration_form_selections_version_fkey';
            columns: ['organization_id', 'tryout_id', 'registration_form_version_id'];
            isOneToOne: false;
            referencedRelation: 'registration_form_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      tryout_registrations: {
        Row: {
          athlete_id: string;
          created_at: string;
          division_id: string;
          id: string;
          organization_id: string;
          position_id: string | null;
          registration_form_version_id: string;
          responses: Json;
          source: string;
          staff_request_digest: string | null;
          status: string;
          submission_digest: string;
          submission_digest_version: number;
          submission_key_digest: string;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          athlete_id: string;
          created_at?: string;
          division_id: string;
          id?: string;
          organization_id: string;
          position_id?: string | null;
          registration_form_version_id: string;
          responses: Json;
          source?: string;
          staff_request_digest?: string | null;
          status?: string;
          submission_digest?: string;
          submission_digest_version?: number;
          submission_key_digest: string;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          created_at?: string;
          division_id?: string;
          id?: string;
          organization_id?: string;
          position_id?: string | null;
          registration_form_version_id?: string;
          responses?: Json;
          source?: string;
          staff_request_digest?: string | null;
          status?: string;
          submission_digest?: string;
          submission_digest_version?: number;
          submission_key_digest?: string;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_registrations_athlete_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_registrations_division_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_divisions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_registrations_form_version_fkey';
            columns: ['organization_id', 'tryout_id', 'registration_form_version_id'];
            isOneToOne: false;
            referencedRelation: 'registration_form_versions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_registrations_position_fkey';
            columns: ['organization_id', 'tryout_id', 'position_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_positions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_registrations_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      tryout_sessions: {
        Row: {
          capacity: number | null;
          created_at: string;
          division_id: string;
          ends_at: string;
          id: string;
          location: string | null;
          name: string;
          organization_id: string;
          sort_order: number;
          starts_at: string;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          capacity?: number | null;
          created_at?: string;
          division_id: string;
          ends_at: string;
          id?: string;
          location?: string | null;
          name: string;
          organization_id: string;
          sort_order?: number;
          starts_at: string;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          capacity?: number | null;
          created_at?: string;
          division_id?: string;
          ends_at?: string;
          id?: string;
          location?: string | null;
          name?: string;
          organization_id?: string;
          sort_order?: number;
          starts_at?: string;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_sessions_division_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_divisions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      tryout_setup_progress: {
        Row: {
          completed_steps: string[];
          id: string;
          last_step: string;
          organization_id: string;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          completed_steps?: string[];
          id?: string;
          last_step?: string;
          organization_id: string;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          completed_steps?: string[];
          id?: string;
          last_step?: string;
          organization_id?: string;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_setup_progress_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: true;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      tryout_staff_assignments: {
        Row: {
          athlete_id: string | null;
          created_at: string;
          division_id: string | null;
          expires_at: string | null;
          granted_by_user_id: string;
          group_id: string | null;
          id: string;
          organization_id: string;
          revoked_at: string | null;
          role: string;
          scope_kind: string;
          session_id: string | null;
          tryout_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          athlete_id?: string | null;
          created_at?: string;
          division_id?: string | null;
          expires_at?: string | null;
          granted_by_user_id: string;
          group_id?: string | null;
          id?: string;
          organization_id: string;
          revoked_at?: string | null;
          role: string;
          scope_kind: string;
          session_id?: string | null;
          tryout_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          athlete_id?: string | null;
          created_at?: string;
          division_id?: string | null;
          expires_at?: string | null;
          granted_by_user_id?: string;
          group_id?: string | null;
          id?: string;
          organization_id?: string;
          revoked_at?: string | null;
          role?: string;
          scope_kind?: string;
          session_id?: string | null;
          tryout_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_staff_assignments_athlete_fkey';
            columns: ['organization_id', 'athlete_id'];
            isOneToOne: false;
            referencedRelation: 'athletes';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_staff_assignments_division_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_divisions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_staff_assignments_group_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id', 'group_id'];
            isOneToOne: false;
            referencedRelation: 'session_groups';
            referencedColumns: ['organization_id', 'tryout_id', 'session_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_staff_assignments_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tryout_staff_assignments_session_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
          {
            foreignKeyName: 'tryout_staff_assignments_tryout_fkey';
            columns: ['organization_id', 'tryout_id'];
            isOneToOne: false;
            referencedRelation: 'tryouts';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      tryout_stations: {
        Row: {
          capacity: number;
          created_at: string;
          created_by: string;
          ends_at: string;
          evaluator_user_id: string | null;
          group_label: string;
          id: string;
          instructions: string;
          location: string;
          name: string;
          organization_id: string;
          session_id: string;
          starts_at: string;
          status: string;
          tryout_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          capacity: number;
          created_at?: string;
          created_by?: string;
          ends_at: string;
          evaluator_user_id?: string | null;
          group_label?: string;
          id?: string;
          instructions?: string;
          location?: string;
          name: string;
          organization_id: string;
          session_id: string;
          starts_at: string;
          status?: string;
          tryout_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          capacity?: number;
          created_at?: string;
          created_by?: string;
          ends_at?: string;
          evaluator_user_id?: string | null;
          group_label?: string;
          id?: string;
          instructions?: string;
          location?: string;
          name?: string;
          organization_id?: string;
          session_id?: string;
          starts_at?: string;
          status?: string;
          tryout_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_stations_organization_id_evaluator_user_id_fkey';
            columns: ['organization_id', 'evaluator_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'tryout_stations_organization_id_tryout_id_session_id_fkey';
            columns: ['organization_id', 'tryout_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_sessions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      tryout_teams: {
        Row: {
          created_at: string;
          division_id: string;
          id: string;
          name: string;
          organization_id: string;
          position_targets: Json;
          sort_order: number;
          target_size: number | null;
          tryout_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          division_id: string;
          id?: string;
          name: string;
          organization_id: string;
          position_targets?: Json;
          sort_order: number;
          target_size?: number | null;
          tryout_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          division_id?: string;
          id?: string;
          name?: string;
          organization_id?: string;
          position_targets?: Json;
          sort_order?: number;
          target_size?: number | null;
          tryout_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tryout_teams_division_fkey';
            columns: ['organization_id', 'tryout_id', 'division_id'];
            isOneToOne: false;
            referencedRelation: 'tryout_divisions';
            referencedColumns: ['organization_id', 'tryout_id', 'id'];
          },
        ];
      };
      tryouts: {
        Row: {
          blind_mode: boolean;
          created_at: string;
          description: string | null;
          ends_at: string | null;
          finalized_at: string | null;
          id: string;
          name: string;
          organization_id: string;
          published_at: string | null;
          registration_ends_at: string | null;
          registration_starts_at: string | null;
          score_visibility: string;
          season_id: string | null;
          slug: string;
          sport: string;
          starts_at: string | null;
          status: string;
          terminology: Json;
          timezone: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          blind_mode?: boolean;
          created_at?: string;
          description?: string | null;
          ends_at?: string | null;
          finalized_at?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          published_at?: string | null;
          registration_ends_at?: string | null;
          registration_starts_at?: string | null;
          score_visibility?: string;
          season_id?: string | null;
          slug: string;
          sport: string;
          starts_at?: string | null;
          status?: string;
          terminology?: Json;
          timezone: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          blind_mode?: boolean;
          created_at?: string;
          description?: string | null;
          ends_at?: string | null;
          finalized_at?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          published_at?: string | null;
          registration_ends_at?: string | null;
          registration_starts_at?: string | null;
          score_visibility?: string;
          season_id?: string | null;
          slug?: string;
          sport?: string;
          starts_at?: string | null;
          status?: string;
          terminology?: Json;
          timezone?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'tryouts_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tryouts_organization_season_fkey';
            columns: ['organization_id', 'season_id'];
            isOneToOne: false;
            referencedRelation: 'seasons';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_organization_invitation: {
        Args: { p_token_digest: string };
        Returns: {
          organization_id: string;
          organization_slug: string;
          outcome: string;
        }[];
      };
      apply_billing_snapshot: {
        Args: { p_event: Json; p_intent_id?: string; p_snapshot: Json };
        Returns: string;
      };
      apply_resend_delivery_event: {
        Args: {
          p_event_id: string;
          p_event_type: string;
          p_message_id: string;
          p_occurred_at: string;
          p_provider_message_id: string;
        };
        Returns: string;
      };
      apply_stripe_subscription_event: {
        Args: {
          p_cancel_at: string | null;
          p_cancel_at_period_end: boolean;
          p_canceled_at: string | null;
          p_current_period_end: string;
          p_current_period_start: string;
          p_customer_id: string;
          p_event_id: string;
          p_event_type: string;
          p_organization_id: string | null;
          p_payload: Json;
          p_payload_digest: string;
          p_plan_key: string | null;
          p_price_id: string | null;
          p_provider_created_at: string;
          p_state: string | null;
          p_subscription_id: string;
          p_trial_end: string | null;
        };
        Returns: string;
      };
      assign_evaluator: {
        Args: {
          p_division_id?: string;
          p_evaluator_user_id: string;
          p_expires_at?: string;
          p_group_id?: string;
          p_organization_id: string;
          p_scope_kind: string;
          p_session_id?: string;
          p_tryout_id: string;
        };
        Returns: {
          assignment_id: string;
          outcome: string;
        }[];
      };
      assign_tryout_number: {
        Args: {
          p_division_id: string;
          p_group_id: string;
          p_organization_id: string;
          p_registration_id: string;
          p_requested: number;
          p_scope_kind: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          assigned_number: number;
          assignment_id: string;
          next_available: number;
          outcome: string;
        }[];
      };
      audit_checkin_number_release: {
        Args: {
          p_actor_user_id: string;
          p_number_id: string;
          p_reason: string;
          p_released_at: string;
        };
        Returns: undefined;
      };
      authorize_integration_outbox_submission: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
        };
        Returns: string;
      };
      authorize_outbox_job_send: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
        };
        Returns: string;
      };
      authorize_outbox_job_send_v2: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_provider_timeout_ms: number;
          p_safety_margin_ms: number;
        };
        Returns: Json;
      };
      begin_support_elevation: {
        Args: {
          p_expires_at: string;
          p_organization_id: string;
          p_reason: string;
        };
        Returns: {
          elevation_id: string;
          expires_at: string;
          outcome: string;
        }[];
      };
      billing_provider_context: {
        Args: { p_organization_id?: string; p_purchaser_id?: string };
        Returns: Json;
      };
      build_performance_export: {
        Args: { p_id: string; p_organization_id: string };
        Returns: boolean;
      };
      calibration_workspace: {
        Args: { p_organization_id: string };
        Returns: Json;
      };
      can_access_evaluation: {
        Args: {
          evaluator_user_id: string;
          is_mutation: boolean;
          target_division_id: string;
          target_organization_id: string;
          target_session_id: string;
          target_tryout_id: string;
        };
        Returns: boolean;
      };
      can_manage_evaluator_scope: {
        Args: {
          p_division_id?: string;
          p_group_id?: string;
          p_organization_id: string;
          p_scope_kind: string;
          p_session_id?: string;
          p_tryout_id: string;
        };
        Returns: boolean;
      };
      can_manage_session_group: {
        Args: {
          target_group_id: string;
          target_organization_id: string;
          target_session_id: string;
          target_tryout_id: string;
        };
        Returns: boolean;
      };
      can_manage_tryout_configuration: {
        Args: {
          target_division_id?: string;
          target_group_id?: string;
          target_organization_id: string;
          target_session_id?: string;
          target_tryout_id: string;
        };
        Returns: boolean;
      };
      can_manage_tryout_division: {
        Args: {
          target_division_id: string;
          target_organization_id: string;
          target_tryout_id: string;
        };
        Returns: boolean;
      };
      can_manage_tryout_root: {
        Args: { target_organization_id: string; target_tryout_id: string };
        Returns: boolean;
      };
      can_manage_tryout_session: {
        Args: {
          target_division_id: string;
          target_organization_id: string;
          target_session_id: string;
          target_tryout_id: string;
        };
        Returns: boolean;
      };
      can_operate_checkin: {
        Args: {
          p_division_id: string;
          p_group_id: string;
          p_organization_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: boolean;
      };
      can_operate_checkin_registration: {
        Args: {
          p_division_id: string;
          p_group_id: string;
          p_organization_id: string;
          p_registration_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: boolean;
      };
      can_read_full_athlete_pii: {
        Args: { target_athlete_id: string; target_organization_id: string };
        Returns: boolean;
      };
      can_read_full_registration_pii: {
        Args: { target_organization_id: string; target_tryout_id: string };
        Returns: boolean;
      };
      can_read_tenant_record: {
        Args: { target_organization_id: string };
        Returns: boolean;
      };
      can_read_tryout_configuration: {
        Args: {
          target_division_id?: string;
          target_group_id?: string;
          target_organization_id: string;
          target_session_id?: string;
          target_tryout_id: string;
        };
        Returns: boolean;
      };
      can_select_director_flag: {
        Args: { p_flag_id: string };
        Returns: boolean;
      };
      can_select_own_evaluation: {
        Args: { p_evaluation_id: string };
        Returns: boolean;
      };
      can_use_talent: { Args: { p_organization_id: string }; Returns: boolean };
      can_view_participant: {
        Args: { p_athlete_id: string; p_organization_id: string };
        Returns: boolean;
      };
      canonical_athlete_identity_lock_key: {
        Args: {
          p_birth_date: string;
          p_family_name: string;
          p_given_name: string;
          p_organization_id: string;
        };
        Returns: number;
      };
      canonical_import_text: { Args: { value: string }; Returns: string };
      canonical_registration_text: { Args: { value: string }; Returns: string };
      change_organization_member: {
        Args: {
          p_expected_version: number;
          p_idempotency_key: string;
          p_member_id: string;
          p_organization_id: string;
          p_role: string;
          p_status: string;
        };
        Returns: {
          member_id: string;
          outcome: string;
          role: string;
          status: string;
          version: number;
        }[];
      };
      change_roster_decisions: {
        Args: {
          p_changes: Json;
          p_confirmation: string;
          p_division_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_roster_version_id: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
          version: number | null;
        }[];
      };
      check_in_registration: {
        Args: {
          p_group_id: string;
          p_idempotency_key: string;
          p_organization_id: string;
          p_registration_id: string;
          p_requested: number;
          p_scope_kind: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          assigned_number: number;
          checked_in_at: string;
          next_available: number;
          outcome: string;
          receipt_id: string;
        }[];
      };
      check_in_registration_v2: {
        Args: {
          p_group_id: string;
          p_idempotency_key: string;
          p_organization_id: string;
          p_registration_id: string;
          p_requested: number;
          p_scope_kind: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          assigned_number: number;
          checked_in_at: string;
          next_available: number;
          outcome: string;
          receipt_id: string;
        }[];
      };
      checkin_assign_number_internal: {
        Args: {
          p_authorization_group_id: string;
          p_authorization_session_id: string;
          p_division_id: string;
          p_number_group_id: string;
          p_number_session_id: string;
          p_organization_id: string;
          p_registration_id: string;
          p_requested: number;
          p_scope_kind: string;
          p_tryout_id: string;
        };
        Returns: {
          assigned_number: number;
          assignment_id: string;
          next_available: number;
          outcome: string;
        }[];
      };
      claim_billing_reconciliation: { Args: never; Returns: string | null };
      claim_integration_outbox_jobs: {
        Args: {
          p_batch_size: number;
          p_lease_owner: string;
          p_lease_seconds: number;
        };
        Returns: Database['public']['CompositeTypes']['claimed_integration_outbox_job'][];
        SetofOptions: {
          from: '*';
          to: 'claimed_integration_outbox_job';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_outbox_jobs: {
        Args: {
          p_batch_size: number;
          p_lease_owner: string;
          p_lease_seconds: number;
        };
        Returns: Database['public']['CompositeTypes']['claimed_outbox_job'][];
        SetofOptions: {
          from: '*';
          to: 'claimed_outbox_job';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      clone_published_tryout_revision: {
        Args: {
          p_name: string;
          p_organization_id: string;
          p_slug: string;
          p_source_tryout_id: string;
        };
        Returns: {
          slug: string;
          tryout_id: string;
        }[];
      };
      commit_athlete_import: {
        Args: {
          p_organization_id: string;
          p_preview_id: string;
          p_selected_rows: number[];
        };
        Returns: {
          athlete_ids: string[];
          outcome: string;
        }[];
      };
      commit_athlete_import_after_identity_locks: {
        Args: {
          p_organization_id: string;
          p_preview_id: string;
          p_selected_rows: number[];
        };
        Returns: {
          athlete_ids: string[];
          outcome: string;
        }[];
      };
      complete_billing_checkout: {
        Args: { p_intent_id: string; p_session_id: string };
        Returns: undefined;
      };
      complete_evaluation: {
        Args: {
          p_division_id: string;
          p_evaluation_id: string;
          p_expected_version: number | null;
          p_group_id: string | null;
          p_organization_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
          version: number | null;
        }[];
      };
      complete_integration_outbox_job: {
        Args: {
          p_external_job_id: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_result: Json;
        };
        Returns: string;
      };
      complete_integration_outbox_job_legacy_077: {
        Args: {
          p_external_job_id: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_result: Json;
        };
        Returns: string;
      };
      complete_integration_outbox_job_legacy_078: {
        Args: {
          p_external_job_id: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_result: Json;
        };
        Returns: string;
      };
      complete_integration_outbox_job_legacy_080: {
        Args: {
          p_external_job_id: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_result: Json;
        };
        Returns: string;
      };
      complete_outbox_job: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_provider_message_id: string;
        };
        Returns: string;
      };
      complete_outbox_job_v2: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_provider_message_id: string;
          p_send_attempt_token: string;
        };
        Returns: string;
      };
      complete_single_tryout: {
        Args: {
          p_expected_version: number;
          p_organization_id: string;
          p_tryout_id: string;
        };
        Returns: string;
      };
      complete_subscription_checkout_intent: {
        Args: {
          p_client_attempt_id: string;
          p_organization_id: string;
          p_result_url: string;
          p_session_id: string;
        };
        Returns: string;
      };
      configure_evaluation_note_tag: {
        Args: {
          p_active: boolean;
          p_label: string;
          p_note_tag_id: string | null;
          p_organization_id: string;
        };
        Returns: {
          note_tag_id: string | null;
          outcome: string;
        }[];
      };
      confirm_roster_export_preview: {
        Args: {
          p_confirmation_token: string;
          p_idempotency_key: string;
          p_organization_id: string;
          p_provider_preview_id: string;
        };
        Returns: Database['public']['CompositeTypes']['integration_export_confirmation_result'];
        SetofOptions: {
          from: '*';
          to: 'integration_export_confirmation_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      confirm_roster_export_preview_v2: {
        Args: {
          p_confirmation_token: string;
          p_idempotency_key: string;
          p_organization_id: string;
          p_provider_preview_id: string;
        };
        Returns: Database['public']['CompositeTypes']['integration_export_confirmation_v2_result'];
        SetofOptions: {
          from: '*';
          to: 'integration_export_confirmation_v2_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      confirm_roster_export_preview_v3: {
        Args: {
          p_confirmation_token: string;
          p_idempotency_key: string;
          p_organization_id: string;
          p_provider_preview_id: string;
        };
        Returns: Database['public']['CompositeTypes']['integration_export_confirmation_v3_result'];
        SetofOptions: {
          from: '*';
          to: 'integration_export_confirmation_v3_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      confirm_roster_export_preview_v4: {
        Args: {
          p_confirmation_token: string;
          p_idempotency_key: string;
          p_organization_id: string;
          p_provider_preview_id: string;
          p_source_digest: string;
        };
        Returns: Database['public']['CompositeTypes']['integration_export_confirmation_v4_result'];
        SetofOptions: {
          from: '*';
          to: 'integration_export_confirmation_v4_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      consume_abuse_rate_limit: {
        Args: {
          p_address_digest: string;
          p_limit: number;
          p_scope: string;
          p_subject_digest: string;
          p_window_seconds: number;
        };
        Returns: {
          allowed: boolean;
          remaining: number;
          retry_after_seconds: number;
        }[];
      };
      consume_bot_token_once: {
        Args: {
          p_action: string;
          p_token_digest: string;
          p_ttl_seconds: number;
        };
        Returns: {
          consumed: boolean;
        }[];
      };
      consume_public_registration_rate_limit: {
        Args: { p_limit: number; p_rate_key_hash: string };
        Returns: {
          outcome: string;
          retry_after_seconds: number;
        }[];
      };
      consume_registration_confirmation_token: {
        Args: { p_token: string };
        Returns: {
          outcome: string;
          registration_id: string;
        }[];
      };
      create_athlete_import_preview: {
        Args: {
          p_column_mapping: Json;
          p_organization_id: string;
          p_preview_rows: Json;
          p_source_digest: string;
        };
        Returns: {
          expires_at: string;
          preview_id: string;
        }[];
      };
      create_calibration_case: {
        Args: {
          p_anchor: number;
          p_explanation: string;
          p_guidance: string;
          p_id: string;
          p_organization_id: string;
          p_prompt: string;
          p_title: string;
        };
        Returns: string;
      };
      create_decision_message_batch: {
        Args: {
          p_confirmation: string;
          p_decision: string;
          p_editable_text: string;
          p_expected_recipient_ids: string[];
          p_expected_version: number;
          p_organization_id: string;
          p_preview_digest: string;
          p_roster_version_id: string;
        };
        Returns: Database['public']['CompositeTypes']['decision_message_batch_result'];
        SetofOptions: {
          from: '*';
          to: 'decision_message_batch_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_decision_message_batch_v2: {
        Args: {
          p_confirmation: string;
          p_division_id: string;
          p_organization_id: string;
          p_preview_digest: string;
          p_preview_token: string;
          p_roster_version_id: string;
          p_tryout_id: string;
        };
        Returns: Database['public']['CompositeTypes']['decision_message_batch_result'];
        SetofOptions: {
          from: '*';
          to: 'decision_message_batch_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_organization_invitation: {
        Args: {
          p_email: string;
          p_expires_at: string;
          p_invitation_id: string;
          p_organization_id: string;
          p_role: string;
          p_token_digest: string;
        };
        Returns: {
          invitation_id: string;
          outcome: string;
        }[];
      };
      create_organization_with_owner: {
        Args: {
          p_name: string;
          p_slug: string;
          p_sport_defaults: Json;
          p_tag_defaults: Json;
          p_terminology: Json;
          p_timezone: string;
        };
        Returns: {
          organization_id: string;
          organization_name: string;
          organization_slug: string;
          owner_user_id: string;
          sport_defaults: Json;
          tag_defaults: Json;
          terminology: Json;
          timezone: string;
        }[];
      };
      create_registration_form_revision: {
        Args: {
          p_organization_id: string;
          p_registration_form_id: string;
          p_source_version_id: string;
        };
        Returns: {
          outcome: string;
          version_id: string;
          version_number: number;
        }[];
      };
      create_roster_draft: {
        Args: {
          p_division_id: string;
          p_organization_id: string;
          p_teams: Json;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
          roster_version_id: string | null;
          version: number | null;
        }[];
      };
      create_rubric_revision: {
        Args: {
          p_organization_id: string;
          p_rubric_id: string;
          p_source_version_id: string;
        };
        Returns: {
          outcome: string;
          version_id: string;
          version_number: number;
        }[];
      };
      create_staff_registration: {
        Args: {
          p_birth_date: string;
          p_division_id: string;
          p_existing_athlete_id: string;
          p_family_name: string;
          p_given_name: string;
          p_organization_id: string;
          p_position_id: string;
          p_responses: Json;
          p_submission_key_digest: string;
          p_tryout_id: string;
        };
        Returns: {
          athlete_id: string;
          outcome: string;
          registration_id: string;
        }[];
      };
      create_staff_registration_v2: {
        Args: {
          p_birth_date: string;
          p_division_id: string;
          p_existing_athlete_id: string;
          p_expected_form_schema: Json;
          p_family_name: string;
          p_given_name: string;
          p_organization_id: string;
          p_position_id: string;
          p_responses: Json;
          p_submission_key_digest: string;
          p_tryout_id: string;
        };
        Returns: {
          athlete_id: string;
          outcome: string;
          registration_id: string;
        }[];
      };
      create_team_workspace: {
        Args: { p_name: string; p_organization_id: string; p_slug: string };
        Returns: string;
      };
      create_tryout_draft: {
        Args: {
          p_name: string;
          p_organization_id: string;
          p_registration_ends_at: string;
          p_registration_starts_at: string;
          p_season_id: string;
          p_slug: string;
          p_sport: string;
          p_timezone: string;
        };
        Returns: {
          created_at: string;
          finalized_at: string;
          name: string;
          organization_id: string;
          published_at: string;
          registration_ends_at: string;
          registration_starts_at: string;
          season_id: string;
          slug: string;
          sport: string;
          status: string;
          timezone: string;
          tryout_id: string;
          updated_at: string;
          version: number;
        }[];
      };
      create_tryout_draft_with_cycle: {
        Args: {
          p_name: string;
          p_new_season_name: string;
          p_organization_id: string;
          p_registration_ends_at: string;
          p_registration_starts_at: string;
          p_season_id: string;
          p_slug: string;
          p_sport: string;
          p_timezone: string;
        };
        Returns: {
          created_at: string;
          finalized_at: string;
          name: string;
          organization_id: string;
          published_at: string;
          registration_ends_at: string;
          registration_starts_at: string;
          season_id: string;
          season_name: string;
          slug: string;
          sport: string;
          status: string;
          timezone: string;
          tryout_id: string;
          updated_at: string;
          version: number;
        }[];
      };
      current_athlete_import_candidate_ids: {
        Args: { p_organization_id: string; p_preview_rows: Json; p_row: number };
        Returns: Json;
      };
      decline_outbox_job_send: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_reason: string;
        };
        Returns: string;
      };
      decline_outbox_job_send_v2: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_reason: string;
          p_send_attempt_token: string;
        };
        Returns: string;
      };
      disconnect_integration_connection: {
        Args: { p_connection_id: string; p_organization_id: string };
        Returns: string;
      };
      download_performance_export: {
        Args: { p_id: string; p_organization_id: string };
        Returns: string;
      };
      duplicate_tryout: {
        Args: { p_organization_id: string; p_source_tryout_id: string };
        Returns: {
          slug: string;
          tryout_id: string;
        }[];
      };
      enqueue_analytics_event: {
        Args: {
          p_correlation_id: string;
          p_event_name: string;
          p_organization_id: string;
          p_workflow: string;
        };
        Returns: {
          event_id: string;
          outcome: string;
        }[];
      };
      evaluator_has_active_context: {
        Args: {
          p_evaluator_user_id: string;
          p_organization_id: string;
          p_registration_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: boolean;
      };
      event_coverage: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: Json;
      };
      fail_integration_outbox_job: {
        Args: {
          p_error_code: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_retryable: boolean;
        };
        Returns: string;
      };
      fail_integration_outbox_job_legacy_077: {
        Args: {
          p_error_code: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_retryable: boolean;
        };
        Returns: string;
      };
      fail_integration_outbox_job_legacy_078: {
        Args: {
          p_error_code: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_retryable: boolean;
        };
        Returns: string;
      };
      fail_integration_outbox_job_legacy_080: {
        Args: {
          p_error_code: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_retryable: boolean;
        };
        Returns: string;
      };
      fail_outbox_job: {
        Args: {
          p_error_code: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_retryable: boolean;
        };
        Returns: string;
      };
      fail_outbox_job_v2: {
        Args: {
          p_error_code: string;
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_retryable: boolean;
          p_send_attempt_token: string;
        };
        Returns: string;
      };
      fail_subscription_checkout_intent: {
        Args: { p_client_attempt_id: string; p_organization_id: string };
        Returns: string;
      };
      finalize_roster_version: {
        Args: {
          p_confirmation: string;
          p_division_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_roster_version_id: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
          version: number | null;
        }[];
      };
      finish_billing_reconciliation: {
        Args: { p_organization_id: string; p_success: boolean };
        Returns: undefined;
      };
      get_account_deletion_request: { Args: never; Returns: Json };
      get_billing_dashboard: {
        Args: { p_organization_id: string };
        Returns: Json;
      };
      get_effective_entitlements: {
        Args: { p_organization_id: string; p_tryout_id?: string };
        Returns: Json;
      };
      get_organization_logo_metadata: {
        Args: { p_organization_id: string };
        Returns: {
          logo_exists: boolean;
          sha256: string | null;
          updated_at: string | null;
        }[];
      };
      get_owned_subscription_account: {
        Args: { p_organization_id: string };
        Returns: {
          cancel_at: string | null;
          cancel_at_period_end: boolean | null;
          canceled_at: string | null;
          current_period_end: string | null;
          current_period_start: string | null;
          organization_id: string;
          plan_key: string | null;
          provider_customer_id: string | null;
          provider_price_id: string | null;
          provider_subscription_id: string | null;
          state: string;
          trial_end: string | null;
          verified_at: string;
          version: number;
        }[];
      };
      get_registration_form_configuration: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: {
          form_name: string;
          form_schema: Json;
          registration_form_version_id: string;
        }[];
      };
      get_registration_notification_settings: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: {
          notification_email: string;
        }[];
      };
      get_single_tryout_lifecycle: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: Json;
      };
      get_tryout_setup_configuration: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: Json;
      };
      get_workspace_navigation: {
        Args: { p_organization_id: string };
        Returns: Json;
      };
      has_active_configuration_assignment: {
        Args: {
          required_role?: string;
          target_division_id?: string;
          target_group_id?: string;
          target_organization_id: string;
          target_session_id?: string;
          target_tryout_id: string;
        };
        Returns: boolean;
      };
      has_active_platform_support_elevation: {
        Args: { target_organization_id: string };
        Returns: boolean;
      };
      has_active_staff_assignment: {
        Args: {
          required_role: string;
          target_athlete_id?: string;
          target_division_id?: string;
          target_group_id?: string;
          target_organization_id: string;
          target_session_id?: string;
          target_tryout_id: string;
        };
        Returns: boolean;
      };
      import_performance_results: {
        Args: { p_organization_id: string; p_rows: Json };
        Returns: number;
      };
      is_active_organization_member: {
        Args: { allowed_roles?: string[]; target_organization_id: string };
        Returns: boolean;
      };
      is_active_platform_administrator: { Args: never; Returns: boolean };
      is_valid_organization_slug: { Args: { value: string }; Returns: boolean };
      is_valid_registration_calendar_date: {
        Args: { value: string };
        Returns: boolean;
      };
      is_valid_registration_email: { Args: { value: string }; Returns: boolean };
      is_valid_registration_phone: { Args: { value: string }; Returns: boolean };
      issue_checkin_qr_token: {
        Args: {
          p_organization_id: string;
          p_registration_id: string;
          p_tryout_id: string;
        };
        Returns: string;
      };
      issue_roster_export_source: {
        Args: {
          p_approved_fields: string[];
          p_connection_id: string;
          p_destination: Json;
          p_organization_id: string;
          p_roster_version_id: string;
        };
        Returns: Database['public']['CompositeTypes']['integration_export_source_result'];
        SetofOptions: {
          from: '*';
          to: 'integration_export_source_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      link_participant: {
        Args: {
          p_athlete_id: string;
          p_email: string;
          p_organization_id: string;
          p_relationship: string;
        };
        Returns: string;
      };
      list_assigned_athletes: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: {
          display_name: string;
          division_id: string;
          division_name: string;
          group_id: string | null;
          group_name: string | null;
          identity_mode: string;
          registration_id: string;
          session_id: string | null;
          session_name: string | null;
          tryout_number: number | null;
        }[];
      };
      list_communication_templates_for_notice: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: {
          editable_text: string;
          id: string;
          message_kind: string;
          version: number;
        }[];
      };
      list_manageable_evaluator_assignments: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: {
          assignment_id: string;
          division_id: string | null;
          evaluator_name: string;
          evaluator_user_id: string;
          expires_at: string | null;
          group_id: string | null;
          scope_kind: string;
          scope_label: string;
          session_id: string | null;
        }[];
      };
      list_organization_evaluators: {
        Args: { p_organization_id: string };
        Returns: {
          active_assignment_count: number;
          display_name: string;
          evaluator_user_id: string;
        }[];
      };
      list_organization_invitations: {
        Args: { p_limit?: number; p_offset?: number; p_organization_id: string };
        Returns: {
          accepted_at: string;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          revoked_at: string;
          role: string;
        }[];
      };
      list_performance_exports: {
        Args: { p_organization_id: string };
        Returns: Json;
      };
      list_returning_athletes: {
        Args: {
          p_limit?: number;
          p_organization_id: string;
          p_query: string;
          p_tryout_id: string;
        };
        Returns: {
          athlete_id: string;
          birth_date: string;
          family_name: string;
          given_name: string;
          prior_registrations: number;
        }[];
      };
      list_team_workspaces: {
        Args: { p_organization_id: string };
        Returns: Json;
      };
      list_tryout_evaluator_candidates: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: {
          active_assignment_count: number;
          display_name: string;
          evaluator_user_id: string;
        }[];
      };
      load_athlete_evaluation_history: {
        Args: { p_athlete_id: string; p_organization_id: string };
        Returns: Json;
      };
      load_athlete_profile_average: {
        Args: {
          p_organization_id: string;
          p_registration_id: string;
          p_rubric_version_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: Json;
      };
      load_live_dashboard: {
        Args: {
          p_division_id?: string;
          p_group_id?: string;
          p_organization_id: string;
          p_session_id?: string;
          p_tryout_id: string;
        };
        Returns: {
          result: Json;
        }[];
      };
      load_onboarding_facts: {
        Args: { p_organization_id: string };
        Returns: {
          result: Json;
        }[];
      };
      load_ranking_snapshot: {
        Args: {
          p_athlete_ids?: string[];
          p_division_id?: string;
          p_group_id?: string;
          p_organization_id: string;
          p_position_id?: string;
          p_session_id?: string;
          p_tryout_id: string;
        };
        Returns: {
          result: Json;
        }[];
      };
      load_report_export: {
        Args: {
          p_export_type: string;
          p_max_rows?: number;
          p_organization_id: string;
          p_roster_version_id?: string;
          p_tryout_id?: string;
        };
        Returns: {
          result: Json;
        }[];
      };
      load_report_summary: {
        Args: { p_organization_id: string; p_tryout_id?: string };
        Returns: {
          result: Json;
        }[];
      };
      load_roster_export_context: {
        Args: {
          p_connection_id: string;
          p_organization_id: string;
          p_roster_version_id: string;
        };
        Returns: {
          mock_data: boolean;
          outcome: string;
          provider_key: string;
          roster: Json;
        }[];
      };
      load_roster_workspace: {
        Args: {
          p_division_id: string;
          p_organization_id: string;
          p_roster_version_id: string;
          p_tryout_id: string;
        };
        Returns: {
          result: Json;
        }[];
      };
      load_staff_registration_configuration: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: {
          divisions: Json;
          form_schema: Json;
          positions: Json;
          tryout_name: string;
          tryout_status: string;
        }[];
      };
      lock_canonical_athlete_identity: {
        Args: {
          p_birth_date: string;
          p_family_name: string;
          p_given_name: string;
          p_organization_id: string;
        };
        Returns: undefined;
      };
      lock_evaluation: {
        Args: {
          p_division_id: string;
          p_evaluation_id: string;
          p_expected_version: number | null;
          p_group_id: string | null;
          p_organization_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
          version: number | null;
        }[];
      };
      lock_evaluator_context: {
        Args: {
          p_division_id: string;
          p_evaluator_user_id: string;
          p_group_id: string;
          p_organization_id: string;
          p_registration_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: boolean;
      };
      lock_manager_evaluation_context: {
        Args: {
          p_division_id: string;
          p_group_id: string;
          p_organization_id: string;
          p_registration_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: boolean;
      };
      manage_billing_override: {
        Args: {
          p_expires_at: string;
          p_organization_id: string;
          p_product_key: string;
          p_reason: string;
          p_revoke_id?: string;
          p_starts_at: string;
          p_tryout_id?: string;
        };
        Returns: string;
      };
      manage_director_evaluation_flag: {
        Args: {
          p_action: string;
          p_division_id: string;
          p_flag_id: string | null;
          p_flag_type: string;
          p_group_id: string | null;
          p_organization_id: string;
          p_registration_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          athlete_flag_id: string | null;
          outcome: string;
        }[];
      };
      manager_has_evaluation_context: {
        Args: {
          p_division_id: string;
          p_group_id: string;
          p_organization_id: string;
          p_registration_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: boolean;
      };
      move_roster_athlete: {
        Args: {
          p_division_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_registration_id: string;
          p_roster_version_id: string;
          p_team_id: string | null;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
          version: number | null;
        }[];
      };
      normalize_registration_text: { Args: { value: string }; Returns: string };
      organization_subscription_can_publish: {
        Args: { p_organization_id: string };
        Returns: boolean;
      };
      participant_offers: { Args: never; Returns: Json };
      participant_registration_options: { Args: never; Returns: Json };
      participant_registration_prefill: {
        Args: { p_athlete_id: string; p_tryout_slug: string };
        Returns: Json;
      };
      participant_schedule: { Args: never; Returns: Json };
      participant_workspace: { Args: never; Returns: Json };
      pending_account_deletion_notices: { Args: never; Returns: Json };
      performance_export_status: {
        Args: { p_id: string; p_organization_id: string };
        Returns: Json;
      };
      platform_account_deletion_requests: { Args: never; Returns: Json };
      platform_health: {
        Args: never;
        Returns: {
          communication_failures: number;
          database_status: string;
          failed_jobs: number;
          integration_failures: number;
          synchronization_problems: number;
          webhook_failures: number;
        }[];
      };
      platform_list_audit_events: {
        Args: { p_limit?: number };
        Returns: {
          action: string;
          actor_user_id: string;
          audit_id: string;
          entity_id: string;
          entity_type: string;
          occurred_at: string;
          organization_id: string;
          organization_slug: string;
        }[];
      };
      platform_list_organizations: {
        Args: { p_limit?: number };
        Returns: {
          organization_created_at: string;
          organization_id: string;
          organization_name: string;
          organization_slug: string;
          organization_status: string;
        }[];
      };
      platform_list_subscriptions: {
        Args: { p_limit?: number };
        Returns: {
          cancel_at_period_end: boolean;
          current_period_end: string;
          organization_id: string;
          organization_name: string;
          organization_slug: string;
          plan_key: string;
          subscription_state: string;
          trial_end: string;
          verified_at: string;
        }[];
      };
      platform_list_support_elevations: {
        Args: { p_limit?: number };
        Returns: {
          created_at: string;
          elevation_id: string;
          expires_at: string;
          organization_id: string;
          organization_slug: string;
          reason: string;
          revoked_at: string;
          support_user_id: string;
        }[];
      };
      platform_update_account_deletion: {
        Args: { p_complete?: boolean; p_confirmed?: boolean; p_id: string };
        Returns: undefined;
      };
      preview_decision_message_batch: {
        Args: {
          p_decision: string;
          p_editable_text: string;
          p_organization_id: string;
          p_roster_version_id: string;
        };
        Returns: Json;
      };
      preview_decision_message_batch_v2: {
        Args: {
          p_decision: string;
          p_editable_text: string;
          p_expected_template_version: number;
          p_organization_id: string;
          p_roster_version_id: string;
          p_template_id: string;
        };
        Returns: Json;
      };
      preview_event_notice: {
        Args: { p_notice_id: string; p_organization_id: string };
        Returns: Json;
      };
      program_attendance: {
        Args: { p_organization_id: string };
        Returns: {
          placements: number;
          tryout_id: string;
        }[];
      };
      public_health_check: {
        Args: never;
        Returns: {
          status: string;
        }[];
      };
      public_registration_tryout: {
        Args: { p_tryout_slug: string };
        Returns: {
          divisions: Json;
          form_schema: Json;
          name: string;
          slug: string;
          tryout_id: string;
        }[];
      };
      public_registration_tryout_v2: {
        Args: { p_tryout_slug: string };
        Returns: {
          divisions: Json;
          form_schema: Json;
          logo_exists: boolean;
          name: string;
          organization_name: string;
          organization_slug: string;
          positions: Json;
          slug: string;
          tryout_id: string;
        }[];
      };
      public_registration_tryout_v3: {
        Args: { p_tryout_slug: string };
        Returns: {
          divisions: Json;
          form_schema: Json;
          form_version_id: string;
          logo_exists: boolean;
          name: string;
          organization_name: string;
          organization_slug: string;
          positions: Json;
          slug: string;
          tryout_id: string;
        }[];
      };
      public_registration_window: {
        Args: { p_tryout_slug: string };
        Returns: {
          name: string;
          organization_name: string;
          outcome: string;
          registration_ends_at: string;
          registration_starts_at: string;
          timezone: string;
        }[];
      };
      publish_registration_form_version: {
        Args: {
          p_expected_version: number;
          p_organization_id: string;
          p_version_id: string;
        };
        Returns: {
          outcome: string;
          version_id: string;
        }[];
      };
      publish_rubric_version: {
        Args: {
          p_expected_version: number;
          p_organization_id: string;
          p_rubric_id: string;
        };
        Returns: {
          outcome: string;
          version_id: string;
        }[];
      };
      publish_tryout: {
        Args: {
          p_expected_version: number;
          p_organization_id: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
          public_slug: string;
        }[];
      };
      purge_expired_athlete_import_previews: {
        Args: { p_limit?: number };
        Returns: number;
      };
      purge_expired_communication_previews: {
        Args: { p_limit?: number };
        Returns: number;
      };
      purge_expired_integration_previews: {
        Args: { p_limit: number };
        Returns: number;
      };
      purge_expired_subscription_checkout_intents: {
        Args: { p_limit?: number };
        Returns: number;
      };
      queue_event_notice: {
        Args: {
          p_expected_digest: string;
          p_notice_id: string;
          p_organization_id: string;
        };
        Returns: Json;
      };
      queue_invitation_communication: {
        Args: {
          p_business_idempotency_key: string;
          p_invitation_id: string;
          p_organization_id: string;
          p_subject: string;
          p_text: string;
        };
        Returns: Database['public']['CompositeTypes']['queue_communication_result'];
        SetofOptions: {
          from: '*';
          to: 'queue_communication_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      queue_invitation_communication_v2: {
        Args: {
          p_business_idempotency_key: string;
          p_invitation_id: string;
          p_invitation_token_digest: string;
          p_organization_id: string;
          p_subject: string;
          p_text: string;
        };
        Returns: Database['public']['CompositeTypes']['queue_communication_result'];
        SetofOptions: {
          from: '*';
          to: 'queue_communication_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      queue_organizer_registration_notification: {
        Args: { p_app_origin: string; p_registration_id: string };
        Returns: Database['public']['CompositeTypes']['queue_communication_result'];
        SetofOptions: {
          from: '*';
          to: 'queue_communication_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      queue_registration_communication: {
        Args: {
          p_business_idempotency_key: string;
          p_guardian_id: string;
          p_message_kind: string;
          p_notice_class: string;
          p_organization_id: string;
          p_registration_id: string;
          p_subject: string;
          p_text: string;
        };
        Returns: Database['public']['CompositeTypes']['queue_communication_result'];
        SetofOptions: {
          from: '*';
          to: 'queue_communication_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      queue_registration_communication_v2: {
        Args: {
          p_business_idempotency_key: string;
          p_command_kind: string;
          p_guardian_id: string;
          p_organization_id: string;
          p_registration_id: string;
          p_subject: string;
          p_text: string;
        };
        Returns: Database['public']['CompositeTypes']['queue_communication_result'];
        SetofOptions: {
          from: '*';
          to: 'queue_communication_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      queue_registration_confirmation_communication: {
        Args: {
          p_business_idempotency_key: string;
          p_guardian_email: string;
          p_registration_id: string;
          p_subject: string;
          p_text: string;
        };
        Returns: Database['public']['CompositeTypes']['queue_communication_result'];
        SetofOptions: {
          from: '*';
          to: 'queue_communication_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      queue_registration_confirmation_communication_v2: {
        Args: {
          p_business_idempotency_key: string;
          p_confirmation_token_digest: string;
          p_guardian_email: string;
          p_registration_id: string;
          p_subject: string;
          p_text: string;
        };
        Returns: Database['public']['CompositeTypes']['queue_communication_result'];
        SetofOptions: {
          from: '*';
          to: 'queue_communication_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      queue_roster_decision_communication: {
        Args: {
          p_business_idempotency_key: string;
          p_expected_decision: string;
          p_guardian_id: string;
          p_message_kind: string;
          p_notice_class: string;
          p_organization_id: string;
          p_registration_id: string;
          p_roster_version_id: string;
          p_subject: string;
          p_text: string;
        };
        Returns: Database['public']['CompositeTypes']['queue_communication_result'];
        SetofOptions: {
          from: '*';
          to: 'queue_communication_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      queue_roster_decision_communication_v2: {
        Args: {
          p_business_idempotency_key: string;
          p_command_kind: string;
          p_expected_decision: string;
          p_guardian_id: string;
          p_organization_id: string;
          p_registration_id: string;
          p_roster_version_id: string;
          p_subject: string;
          p_text: string;
        };
        Returns: Database['public']['CompositeTypes']['queue_communication_result'];
        SetofOptions: {
          from: '*';
          to: 'queue_communication_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      read_athlete_portrait: {
        Args: { p_athlete_id: string; p_organization_id: string };
        Returns: Json;
      };
      read_organization_logo_service: {
        Args: { p_organization_slug: string };
        Returns: {
          byte_length: number;
          content: string;
          content_type: string;
          sha256: string;
          updated_at: string;
        }[];
      };
      record_account_deletion_notice: {
        Args: { p_id: string; p_provider_id: string };
        Returns: undefined;
      };
      record_billing_analytics: {
        Args: { p_event: string; p_id: string; p_organization_id: string };
        Returns: undefined;
      };
      record_billing_delivery: {
        Args: {
          p_digest: string;
          p_id: string;
          p_provider: string;
          p_success?: boolean;
          p_type: string;
        };
        Returns: string;
      };
      record_outbox_job_delivery_uncertain_v2: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_send_attempt_token: string;
        };
        Returns: string;
      };
      registration_has_missing_information: {
        Args: { p_registration_id: string };
        Returns: boolean;
      };
      registration_whitespace_characters: { Args: never; Returns: string };
      reissue_registration_confirmation_token: {
        Args: { p_guardian_email: string; p_token: string };
        Returns: {
          confirmation_token: string;
          outcome: string;
        }[];
      };
      release_tryout_number: {
        Args: {
          p_group_id: string;
          p_organization_id: string;
          p_reason: string;
          p_registration_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: string;
      };
      remove_organization_logo: {
        Args: { p_organization_id: string };
        Returns: string;
      };
      reopen_evaluation: {
        Args: {
          p_division_id: string;
          p_evaluation_id: string;
          p_expected_version: number | null;
          p_group_id: string | null;
          p_organization_id: string;
          p_reason: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
          version: number | null;
        }[];
      };
      request_account_deletion: { Args: { p_confirm: boolean }; Returns: Json };
      reserve_billing_purchase: {
        Args: {
          p_id: string;
          p_organization_id: string;
          p_product_key: string;
          p_provider: string;
          p_tryout_id: string;
        };
        Returns: Json;
      };
      reserve_native_plan_replacement: {
        Args: { p_id: string; p_previous_id: string; p_snapshot: Json };
        Returns: string;
      };
      reserve_subscription_checkout_intent: {
        Args: {
          p_client_attempt_id: string;
          p_initiating_owner_user_id: string;
          p_organization_id: string;
          p_plan_key: string;
        };
        Returns: {
          idempotency_key: string;
          outcome: string;
          result_url: string;
          session_id: string;
        }[];
      };
      resolve_athlete_import_duplicate: {
        Args: {
          p_decision: string;
          p_organization_id: string;
          p_preview_id: string;
          p_row: number;
        };
        Returns: {
          outcome: string;
        }[];
      };
      resolve_registration_duplicate: {
        Args: {
          p_candidate_id: string;
          p_decision: string;
          p_organization_id: string;
        };
        Returns: {
          outcome: string;
        }[];
      };
      respond_to_offer: {
        Args: {
          p_athlete_id: string;
          p_organization_id: string;
          p_response: string;
          p_scenario_id: string;
        };
        Returns: boolean;
      };
      retry_integration_sync_job: {
        Args: {
          p_idempotency_key: string;
          p_job_id: string;
          p_organization_id: string;
        };
        Returns: Database['public']['CompositeTypes']['integration_retry_result'];
        SetofOptions: {
          from: '*';
          to: 'integration_retry_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      retry_integration_sync_job_v2: {
        Args: {
          p_idempotency_key: string;
          p_job_id: string;
          p_organization_id: string;
        };
        Returns: Database['public']['CompositeTypes']['integration_retry_v2_result'];
        SetofOptions: {
          from: '*';
          to: 'integration_retry_v2_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      retry_integration_sync_job_v3: {
        Args: {
          p_idempotency_key: string;
          p_job_id: string;
          p_organization_id: string;
        };
        Returns: Database['public']['CompositeTypes']['integration_retry_v3_result'];
        SetofOptions: {
          from: '*';
          to: 'integration_retry_v3_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      retry_integration_sync_job_v4: {
        Args: {
          p_idempotency_key: string;
          p_job_id: string;
          p_organization_id: string;
        };
        Returns: Database['public']['CompositeTypes']['integration_retry_v4_result'];
        SetofOptions: {
          from: '*';
          to: 'integration_retry_v4_result';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      revise_roster_version: {
        Args: {
          p_confirmation: string;
          p_division_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_reason: string;
          p_roster_version_id: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
          roster_version_id: string | null;
          version: number | null;
        }[];
      };
      revoke_evaluator_assignment: {
        Args: { p_assignment_id: string; p_organization_id: string };
        Returns: {
          outcome: string;
        }[];
      };
      revoke_orphaned_staff_assignments: { Args: never; Returns: number };
      rotate_registration_confirmation_token: {
        Args: { p_registration_id: string };
        Returns: string;
      };
      save_athlete_contact: {
        Args: {
          p_athlete_id: string;
          p_email: string;
          p_expected_updated_at?: string | null;
          p_guardian_id?: string | null;
          p_name: string;
          p_organization_id: string;
          p_phone: string;
          p_relationship: string;
        };
        Returns: string;
      };
      save_athlete_portrait: {
        Args: {
          p_athlete_id: string;
          p_base64: string;
          p_organization_id: string;
          p_sha256: string;
          p_version: number;
        };
        Returns: number;
      };
      save_communication_template: {
        Args: {
          p_editable_text: string;
          p_expected_version: number;
          p_message_kind: string;
          p_organization_id: string;
        };
        Returns: Json;
      };
      save_eligibility_exception: {
        Args: {
          p_athlete_id: string;
          p_organization_id: string;
          p_policy_version: number;
          p_reason: string;
          p_status: string;
          p_tryout_id: string;
          p_version: number;
        };
        Returns: boolean;
      };
      save_eligibility_policy: {
        Args: {
          p_cutoff_date: string;
          p_organization_id: string;
          p_rules: string;
          p_tryout_id: string;
          p_version: number;
        };
        Returns: boolean;
      };
      save_evaluation_draft: {
        Args: {
          p_division_id: string;
          p_expected_version: number | null;
          p_flags?: string[];
          p_group_id: string | null;
          p_note?: string | null;
          p_note_tag_ids?: string[];
          p_organization_id: string;
          p_registration_id: string;
          p_rubric_version_id: string;
          p_scores: Json;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          evaluation_id: string | null;
          outcome: string;
          version: number | null;
        }[];
      };
      save_integration_connection: {
        Args: {
          p_connection_id: string;
          p_display_name: string;
          p_mock_data: boolean;
          p_organization_id: string;
          p_provider_key: string;
        };
        Returns: string;
      };
      save_prospect_identity: {
        Args: {
          p_birth_date: string | null;
          p_expected_updated_at?: string | null;
          p_family_name: string;
          p_given_name: string;
          p_id: string;
          p_organization_id: string;
        };
        Returns: string;
      };
      save_registration_form_configuration: {
        Args: {
          p_organization_id: string;
          p_payload: Json;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
        }[];
      };
      save_roster_export_preview: {
        Args: {
          p_approved_fields: string[];
          p_confirmation_token: string;
          p_connection_id: string;
          p_destination: Json;
          p_organization_id: string;
          p_payload_digest: string;
          p_preview: Json;
          p_provider_preview_id: string;
          p_roster_version_id: string;
          p_snapshot_digest: string;
        };
        Returns: string;
      };
      save_roster_export_preview_v2: {
        Args: {
          p_confirmation_token: string;
          p_organization_id: string;
          p_preview: Json;
          p_provider_preview_id: string;
          p_source_digest: string;
          p_source_id: string;
        };
        Returns: string;
      };
      save_tryout_setup_step: {
        Args: { p_organization_id: string; p_step: string; p_tryout_id: string };
        Returns: {
          outcome: string;
        }[];
      };
      save_tryout_wizard_configuration: {
        Args: {
          p_organization_id: string;
          p_payload: Json;
          p_step: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
        }[];
      };
      save_tryout_wizard_configuration_v088: {
        Args: {
          p_organization_id: string;
          p_payload: Json;
          p_step: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
        }[];
      };
      scouting_people: {
        Args: { p_organization_id: string };
        Returns: {
          display_name: string;
          user_id: string;
        }[];
      };
      search_checkin_registrations: {
        Args: {
          p_limit: number;
          p_organization_id: string;
          p_query: string;
          p_rate_key_hash: string;
          p_tryout_id: string;
        };
        Returns: {
          athlete_name: string;
          checkin_status: string;
          division_name: string;
          guardian_name: string;
          registration_id: string;
          tryout_number: number;
        }[];
      };
      search_checkin_registrations_v2: {
        Args: {
          p_group_id: string;
          p_limit: number;
          p_organization_id: string;
          p_query: string;
          p_rate_key_hash: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          athlete_name: string;
          checkin_status: string;
          division_name: string;
          guardian_name: string;
          outcome: string;
          registration_id: string;
          tryout_number: number;
        }[];
      };
      select_tryout_registration_form_version: {
        Args: {
          p_organization_id: string;
          p_registration_form_version_id: string;
          p_tryout_id: string;
        };
        Returns: {
          outcome: string;
        }[];
      };
      start_performance_export: {
        Args: { p_filters: Json; p_id: string; p_organization_id: string };
        Returns: string;
      };
      start_pro_trial: { Args: { p_organization_id: string }; Returns: Json };
      submit_calibration: {
        Args: {
          p_case_id: string;
          p_organization_id: string;
          p_rationale: string;
          p_score: number;
        };
        Returns: string;
      };
      submit_public_registration: {
        Args: {
          p_idempotency_key: string;
          p_rate_key_hash: string;
          p_submission: Json;
          p_tryout_slug: string;
        };
        Returns: {
          confirmation_token: string;
          outcome: string;
          registration_id: string;
        }[];
      };
      submit_public_registration_v2: {
        Args: {
          p_idempotency_key: string;
          p_rate_key_hash: string;
          p_submission: Json;
          p_tryout_slug: string;
        };
        Returns: {
          confirmation_token: string;
          outcome: string;
          registration_id: string;
        }[];
      };
      submit_public_registration_with_notification: {
        Args: {
          p_app_origin: string;
          p_idempotency_key: string;
          p_rate_key_hash: string;
          p_submission: Json;
          p_tryout_slug: string;
        };
        Returns: {
          confirmation_token: string;
          outcome: string;
          registration_id: string;
        }[];
      };
      submit_public_registration_with_notification_v2: {
        Args: {
          p_app_origin: string;
          p_expected_form_version_id: string;
          p_idempotency_key: string;
          p_rate_key_hash: string;
          p_submission: Json;
          p_tryout_slug: string;
        };
        Returns: {
          confirmation_token: string;
          outcome: string;
          registration_id: string;
        }[];
      };
      submit_public_registration_with_phone: {
        Args: {
          p_idempotency_key: string;
          p_rate_key_hash: string;
          p_submission: Json;
          p_tryout_slug: string;
        };
        Returns: {
          confirmation_token: string;
          outcome: string;
          registration_id: string;
        }[];
      };
      submit_public_registration_with_position: {
        Args: {
          p_idempotency_key: string;
          p_position_id?: string;
          p_rate_key_hash: string;
          p_submission: Json;
          p_tryout_slug: string;
        };
        Returns: {
          confirmation_token: string;
          outcome: string;
          registration_id: string;
        }[];
      };
      sync_evaluation_mutation: {
        Args: {
          p_client_mutation_id: string;
          p_draft: Json;
          p_evaluation_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_registration_id: string;
          p_rubric_version_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          receipt: Json;
        }[];
      };
      sync_evaluation_mutation_legacy: {
        Args: {
          p_client_mutation_id: string;
          p_draft: Json;
          p_evaluation_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_registration_id: string;
          p_rubric_version_id: string;
          p_session_id: string;
          p_tryout_id: string;
        };
        Returns: {
          receipt: Json;
        }[];
      };
      transfer_organization_ownership: {
        Args: {
          p_expected_actor_version: number;
          p_expected_target_version: number;
          p_idempotency_key: string;
          p_organization_id: string;
          p_target_member_id: string;
        };
        Returns: {
          former_owner_member_id: string;
          new_owner_member_id: string;
          outcome: string;
        }[];
      };
      transition_tryout_lifecycle: {
        Args: {
          p_action: string;
          p_expected_version: number;
          p_organization_id: string;
          p_tryout_id: string;
        };
        Returns: {
          created_at: string;
          finalized_at: string;
          name: string;
          organization_id: string;
          outcome: string;
          published_at: string;
          registration_ends_at: string;
          registration_starts_at: string;
          season_id: string;
          slug: string;
          sport: string;
          status: string;
          timezone: string;
          tryout_id: string;
          updated_at: string;
          version: number;
        }[];
      };
      upsert_organization_logo: {
        Args: {
          p_content_base64: string;
          p_organization_id: string;
          p_sha256: string;
        };
        Returns: string;
      };
      upsert_organization_logo_service: {
        Args: {
          p_actor_user_id: string;
          p_content_base64: string;
          p_organization_id: string;
          p_sha256: string;
        };
        Returns: string;
      };
      validate_integration_outbox_execution: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
        };
        Returns: string;
      };
      validate_tryout_for_publish: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: {
          blocker: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      claimed_integration_outbox_job: {
        outbox_job_id: string | null;
        sync_job_id: string | null;
        organization_id: string | null;
        connection_id: string | null;
        provider_key: string | null;
        actor_user_id: string | null;
        lease_token: string | null;
        lease_generation: number | null;
        lease_expires_at: string | null;
        provider_idempotency_key: string | null;
        attempt_number: number | null;
        item_keys: string[] | null;
        confirmed_request: Json | null;
      };
      claimed_outbox_job: {
        job_id: string | null;
        message_id: string | null;
        lease_token: string | null;
        lease_generation: number | null;
        lease_expires_at: string | null;
        provider_idempotency_key: string | null;
        recipient_email: string | null;
        subject: string | null;
        body_text: string | null;
        attempt_count: number | null;
        max_attempts: number | null;
        body_html: string | null;
      };
      decision_message_batch_result: {
        outcome: string | null;
        batch_id: string | null;
        queued_count: number | null;
      };
      integration_export_confirmation_result: {
        outcome: string | null;
        job_id: string | null;
      };
      integration_export_confirmation_v2_result: {
        outcome: string | null;
        job_id: string | null;
        state: string | null;
        item_count: number | null;
        completed_count: number | null;
        skipped_count: number | null;
        failed_count: number | null;
      };
      integration_export_confirmation_v3_result: {
        outcome: string | null;
        job_id: string | null;
        state: string | null;
        item_count: number | null;
        completed_count: number | null;
        skipped_count: number | null;
        failed_count: number | null;
        retry_eligible_count: number | null;
      };
      integration_export_confirmation_v4_result: {
        outcome: string | null;
        job_id: string | null;
        state: string | null;
        item_count: number | null;
        completed_count: number | null;
        skipped_count: number | null;
        failed_count: number | null;
        retry_eligible_count: number | null;
      };
      integration_export_source_result: {
        outcome: string | null;
        source_id: string | null;
        provider_key: string | null;
        mock_data: boolean | null;
        roster: Json | null;
        source_digest: string | null;
        existing_athlete_ids: string[] | null;
      };
      integration_retry_result: {
        outcome: string | null;
        job_id: string | null;
        retried_item_count: number | null;
        preserved_completed_item_count: number | null;
      };
      integration_retry_v2_result: {
        outcome: string | null;
        job_id: string | null;
        state: string | null;
        retried_item_count: number | null;
        preserved_completed_item_count: number | null;
        preserved_skipped_item_count: number | null;
      };
      integration_retry_v3_result: {
        outcome: string | null;
        job_id: string | null;
        state: string | null;
        retried_item_count: number | null;
        preserved_completed_item_count: number | null;
        preserved_skipped_item_count: number | null;
        completed_count: number | null;
        skipped_count: number | null;
        failed_count: number | null;
        retry_eligible_count: number | null;
      };
      integration_retry_v4_result: {
        outcome: string | null;
        job_id: string | null;
        state: string | null;
        retried_item_count: number | null;
        preserved_completed_item_count: number | null;
        preserved_skipped_item_count: number | null;
        completed_count: number | null;
        skipped_count: number | null;
        failed_count: number | null;
        retry_eligible_count: number | null;
      };
      queue_communication_result: {
        outcome: string | null;
        message_id: string | null;
        job_id: string | null;
      };
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
