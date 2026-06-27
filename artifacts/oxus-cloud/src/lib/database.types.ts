export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          contact_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          kind: string
          title: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          kind?: string
          title: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          kind?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          doc_type: string
          entity_id: string
          entity_type: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          is_active: boolean
          mime_type: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          doc_type?: string
          entity_id: string
          entity_type: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          is_active?: boolean
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          is_active?: boolean
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          client_id: string | null
          color: string | null
          created_at: string
          created_by: string | null
          end_time: string | null
          event_date: string
          id: string
          location: string | null
          project_id: string | null
          start_time: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          event_date: string
          id?: string
          location?: string | null
          project_id?: string | null
          start_time?: string | null
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          event_date?: string
          id?: string
          location?: string | null
          project_id?: string | null
          start_time?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          industry: string | null
          name: string
          notes: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          availability: string | null
          client_id: string | null
          company: string | null
          created_at: string
          created_by: string | null
          email: string | null
          employment_type: string | null
          hourly_rate: number | null
          id: string
          job_title: string | null
          last_contact_at: string | null
          location: string | null
          name: string
          notes: string | null
          phone: string | null
          relationship_strength: string
          source: string | null
          stack: string[]
          type: string
          updated_at: string
        }
        Insert: {
          availability?: string | null
          client_id?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          employment_type?: string | null
          hourly_rate?: number | null
          id?: string
          job_title?: string | null
          last_contact_at?: string | null
          location?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          relationship_strength?: string
          source?: string | null
          stack?: string[]
          type?: string
          updated_at?: string
        }
        Update: {
          availability?: string | null
          client_id?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          employment_type?: string | null
          hourly_rate?: number | null
          id?: string
          job_title?: string | null
          last_contact_at?: string | null
          location?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          relationship_strength?: string
          source?: string | null
          stack?: string[]
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      event_attendees: {
        Row: {
          event_id: string
          team_member_id: string
        }
        Insert: {
          event_id: string
          team_member_id: string
        }
        Update: {
          event_id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendees_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_member_stats"
            referencedColumns: ["team_member_id"]
          },
          {
            foreignKeyName: "event_attendees_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      event_user_attendees: {
        Row: {
          event_id: string
          user_id: string
        }
        Insert: {
          event_id: string
          user_id: string
        }
        Update: {
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_user_attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_user_attendees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          position: number
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          position?: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          amount_paid: number
          client_id: string | null
          client_name: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          issue_date: string
          last_reminder_at: string | null
          number: string
          owner_id: string | null
          owner_name: string | null
          paid_date: string | null
          payment_method: string | null
          project: string | null
          project_id: string | null
          status: string
          stripe_status: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          amount_paid?: number
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string
          last_reminder_at?: string | null
          number: string
          owner_id?: string | null
          owner_name?: string | null
          paid_date?: string | null
          payment_method?: string | null
          project?: string | null
          project_id?: string | null
          status?: string
          stripe_status?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_paid?: number
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string
          last_reminder_at?: string | null
          number?: string
          owner_id?: string | null
          owner_name?: string | null
          paid_date?: string | null
          payment_method?: string | null
          project?: string | null
          project_id?: string | null
          status?: string
          stripe_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_member_stats"
            referencedColumns: ["team_member_id"]
          },
          {
            foreignKeyName: "invoices_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_assignees: {
        Row: {
          created_at: string
          project_id: string
          team_member_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          team_member_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assignees_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignees_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_member_stats"
            referencedColumns: ["team_member_id"]
          },
          {
            foreignKeyName: "project_assignees_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      project_contact_assignees: {
        Row: {
          contact_id: string
          created_at: string
          project_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          project_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_contact_assignees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contact_assignees_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_user_assignees: {
        Row: {
          created_at: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_user_assignees_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_user_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget: number
          client_id: string | null
          client_name: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          description: string | null
          draft_step: number
          health: string
          id: string
          is_draft: boolean
          name: string
          organization_id: string | null
          owner_id: string | null
          point_of_contact_id: string | null
          priority: string
          progress: number
          project_type: string | null
          risk: string
          source_quote_id: string | null
          start_date: string | null
          status: string
          technology_id: string | null
          updated_at: string
        }
        Insert: {
          budget?: number
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          draft_step?: number
          health?: string
          id?: string
          is_draft?: boolean
          name: string
          organization_id?: string | null
          owner_id?: string | null
          point_of_contact_id?: string | null
          priority?: string
          progress?: number
          project_type?: string | null
          risk?: string
          source_quote_id?: string | null
          start_date?: string | null
          status?: string
          technology_id?: string | null
          updated_at?: string
        }
        Update: {
          budget?: number
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          draft_step?: number
          health?: string
          id?: string
          is_draft?: boolean
          name?: string
          organization_id?: string | null
          owner_id?: string | null
          point_of_contact_id?: string | null
          priority?: string
          progress?: number
          project_type?: string | null
          risk?: string
          source_quote_id?: string | null
          start_date?: string | null
          status?: string
          technology_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_point_of_contact_id_fkey"
            columns: ["point_of_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_source_quote_id_fkey"
            columns: ["source_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_technology_id_fkey"
            columns: ["technology_id"]
            isOneToOne: false
            referencedRelation: "technologies"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          assigned_user_id: string | null
          budget: number
          client_id: string | null
          company: string
          contact_id: string | null
          contact_name: string | null
          converted_project_id: string | null
          created_at: string
          created_by: string | null
          id: string
          next_action: string | null
          number: string | null
          organization_id: string | null
          owner_id: string | null
          point_of_contact_id: string | null
          position: number
          project_description: string | null
          project_name: string | null
          project_type: string | null
          stage: string
          stage_entered_at: string
          tags: string[]
          technology_id: string | null
          updated_at: string
          urgency: string
        }
        Insert: {
          assigned_user_id?: string | null
          budget?: number
          client_id?: string | null
          company: string
          contact_id?: string | null
          contact_name?: string | null
          converted_project_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          next_action?: string | null
          number?: string | null
          organization_id?: string | null
          owner_id?: string | null
          point_of_contact_id?: string | null
          position?: number
          project_description?: string | null
          project_name?: string | null
          project_type?: string | null
          stage?: string
          stage_entered_at?: string
          tags?: string[]
          technology_id?: string | null
          updated_at?: string
          urgency?: string
        }
        Update: {
          assigned_user_id?: string | null
          budget?: number
          client_id?: string | null
          company?: string
          contact_id?: string | null
          contact_name?: string | null
          converted_project_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          next_action?: string | null
          number?: string | null
          organization_id?: string | null
          owner_id?: string | null
          point_of_contact_id?: string | null
          position?: number
          project_description?: string | null
          project_name?: string | null
          project_type?: string | null
          stage?: string
          stage_entered_at?: string
          tags?: string[]
          technology_id?: string | null
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_member_stats"
            referencedColumns: ["team_member_id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_converted_project_id_fkey"
            columns: ["converted_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_point_of_contact_id_fkey"
            columns: ["point_of_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_technology_id_fkey"
            columns: ["technology_id"]
            isOneToOne: false
            referencedRelation: "technologies"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          due_date: string | null
          entity_id: string
          entity_type: string
          id: string
          position: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          due_date?: string | null
          entity_id: string
          entity_type: string
          id?: string
          position?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          due_date?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          position?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          availability: string
          avatar_url: string | null
          created_at: string
          created_by: string | null
          email: string | null
          employment_type: string
          hourly_rate: number | null
          id: string
          job_title: string | null
          location: string | null
          name: string
          notes: string | null
          profile_id: string | null
          stack: string[]
          status: string
          unpaid_invoices: number
          updated_at: string
        }
        Insert: {
          availability?: string
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          employment_type?: string
          hourly_rate?: number | null
          id?: string
          job_title?: string | null
          location?: string | null
          name: string
          notes?: string | null
          profile_id?: string | null
          stack?: string[]
          status?: string
          unpaid_invoices?: number
          updated_at?: string
        }
        Update: {
          availability?: string
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          employment_type?: string
          hourly_rate?: number | null
          id?: string
          job_title?: string | null
          location?: string | null
          name?: string
          notes?: string | null
          profile_id?: string | null
          stack?: string[]
          status?: string
          unpaid_invoices?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      technologies: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          category: string
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          invoice_id: string | null
          occurred_on: string
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          invoice_id?: string | null
          occurred_on?: string
          type?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          invoice_id?: string | null
          occurred_on?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      team_member_stats: {
        Row: {
          active_projects: number | null
          team_member_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      delete_own_account: { Args: never; Returns: undefined }
      is_team_member: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
