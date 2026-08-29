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
          entity_id: string;
          entity_type: string;
          id: string;
          occurred_at: string;
          organization_id: string;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          occurred_at?: string;
          organization_id: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
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
      guardians: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          name: string;
          normalized_email: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          name: string;
          normalized_email: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          name?: string;
          normalized_email?: string;
          organization_id?: string;
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
        };
        Insert: {
          candidate_athlete_id: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          reason: string;
          registration_id: string;
        };
        Update: {
          candidate_athlete_id?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          reason?: string;
          registration_id?: string;
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
          registration_form_version_id: string;
          responses: Json;
          source: string;
          status: string;
          submission_digest: string;
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
          registration_form_version_id: string;
          responses: Json;
          source?: string;
          status?: string;
          submission_digest?: string;
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
          registration_form_version_id?: string;
          responses?: Json;
          source?: string;
          status?: string;
          submission_digest?: string;
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
      consume_registration_confirmation_token: {
        Args: { p_token: string };
        Returns: {
          outcome: string;
          registration_id: string;
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
      [_ in never]: never;
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
