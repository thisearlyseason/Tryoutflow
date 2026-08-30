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
      athletes: {
        Row: {
          birth_date: string;
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
          birth_date: string;
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
          birth_date?: string;
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
      communication_messages: {
        Row: {
          attention_required_at: string | null;
          business_idempotency_key: string;
          cancellation_reason: string | null;
          content_snapshot: Json;
          created_at: string;
          id: string;
          message_kind: string;
          notice_class: string;
          organization_id: string;
          provider_message_id: string | null;
          recipient_snapshot: Json;
          request_digest: string;
          source_authorizing_user_id: string | null;
          source_binding_version: number;
          source_confirmation_token_digest: string | null;
          source_expected_decision: string | null;
          source_guardian_id: string | null;
          source_id: string;
          source_invitation_token_digest: string | null;
          source_kind: string;
          source_registration_id: string | null;
          source_roster_version_id: string | null;
          state: string;
          submitted_at: string | null;
          updated_at: string;
        };
        Insert: {
          attention_required_at?: string | null;
          business_idempotency_key: string;
          cancellation_reason?: string | null;
          content_snapshot: Json;
          created_at?: string;
          id?: string;
          message_kind: string;
          notice_class: string;
          organization_id: string;
          provider_message_id?: string | null;
          recipient_snapshot: Json;
          request_digest: string;
          source_authorizing_user_id?: string | null;
          source_binding_version?: number;
          source_confirmation_token_digest?: string | null;
          source_expected_decision?: string | null;
          source_guardian_id?: string | null;
          source_id: string;
          source_invitation_token_digest?: string | null;
          source_kind: string;
          source_registration_id?: string | null;
          source_roster_version_id?: string | null;
          state?: string;
          submitted_at?: string | null;
          updated_at?: string;
        };
        Update: {
          attention_required_at?: string | null;
          business_idempotency_key?: string;
          cancellation_reason?: string | null;
          content_snapshot?: Json;
          created_at?: string;
          id?: string;
          message_kind?: string;
          notice_class?: string;
          organization_id?: string;
          provider_message_id?: string | null;
          recipient_snapshot?: Json;
          request_digest?: string;
          source_authorizing_user_id?: string | null;
          source_binding_version?: number;
          source_confirmation_token_digest?: string | null;
          source_expected_decision?: string | null;
          source_guardian_id?: string | null;
          source_id?: string;
          source_invitation_token_digest?: string | null;
          source_kind?: string;
          source_registration_id?: string | null;
          source_roster_version_id?: string | null;
          state?: string;
          submitted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'communication_messages_organization_id_fkey';
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
      guardians: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          name: string;
          normalized_email: string;
          organization_id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          name: string;
          normalized_email: string;
          organization_id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          name?: string;
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
          organization_id: string;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
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
          slug?: string;
          sport_defaults?: Json;
          status?: string;
          tag_defaults?: Json;
          terminology?: Json;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
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
          job_id: string;
          lease_generation: number;
          lease_token: string;
          organization_id: string;
          started_at: string;
        };
        Insert: {
          job_id: string;
          lease_generation: number;
          lease_token: string;
          organization_id: string;
          started_at?: string;
        };
        Update: {
          job_id?: string;
          lease_generation?: number;
          lease_token?: string;
          organization_id?: string;
          started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'outbox_provider_handoffs_organization_id_job_id_fkey';
            columns: ['organization_id', 'job_id'];
            isOneToOne: false;
            referencedRelation: 'outbox_jobs';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
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
      authorize_outbox_job_send: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
        };
        Returns: string;
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
      complete_outbox_job: {
        Args: {
          p_job_id: string;
          p_lease_generation: number;
          p_lease_token: string;
          p_provider_message_id: string;
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
      current_athlete_import_candidate_ids: {
        Args: { p_organization_id: string; p_preview_rows: Json; p_row: number };
        Returns: Json;
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
      is_active_organization_member: {
        Args: { allowed_roles?: string[]; target_organization_id: string };
        Returns: boolean;
      };
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
      list_tryout_evaluator_candidates: {
        Args: { p_organization_id: string; p_tryout_id: string };
        Returns: {
          active_assignment_count: number;
          display_name: string;
          evaluator_user_id: string;
        }[];
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
          name: string;
          positions: Json;
          slug: string;
          tryout_id: string;
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
