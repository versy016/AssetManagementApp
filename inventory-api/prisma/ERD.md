# GearOps — Database ER Diagram

<!-- AUTO-GENERATED from schema.prisma by scripts/generate-erd.js. Do not edit by hand — run `npm run db:erd`. -->

Diagram of the PostgreSQL schema, generated from `schema.prisma`. GitHub, VS Code
(Markdown Preview Mermaid Support), and most Markdown viewers render it natively.

> Legend: `PK` = primary key, `FK` = foreign key, `UK` = unique.
> `||--o{` = one-to-many, `||--||` = one-to-one.

> **Standalone tables** (no foreign-key relations): `app_settings`, `asset_deletions`, `registered_domains`.

```mermaid
erDiagram
    assets ||--o{ asset_logs : "assets"
    users ||--o{ asset_logs : "users"
    users ||--o{ assets : "AssetAssignment"
    asset_types ||--o{ assets : "asset_types"
    assets ||--o{ asset_field_values : "asset"
    asset_type_fields ||--o{ asset_field_values : "asset_type_field"
    asset_types ||--o{ asset_type_fields : "asset_type"
    field_types ||--o{ asset_type_fields : "field_type"
    assets ||--o{ asset_documents : "asset"
    asset_type_fields ||--o{ asset_documents : "asset_type_field"
    users ||--o{ users : "UserInvites"
    assets ||--o{ asset_actions : "asset"
    users ||--o{ asset_actions : "ActionPerformer"
    users ||--o{ asset_actions : "ActionFrom"
    users ||--o{ asset_actions : "ActionTo"
    asset_actions ||--|| asset_action_details : "action"
    assets ||--o{ tasks : "TaskAsset"
    users ||--o{ tasks : "TaskAssignee"
    users ||--o{ tasks : "TaskCreator"

    asset_logs {
        string id PK
        string asset_id FK
        string message
        datetime date
        string user_id FK
    }

    asset_types {
        string id PK
        string name
        string image_url
        datetime created_at
        datetime updated_at
    }

    assets {
        string type_id FK
        string serial_number
        string model
        string description
        string other_id
        string assigned_to_id FK
        string status
        boolean needs_repair
        boolean maintenance_due
        datetime next_service_date
        string documentation_url
        string image_url
        datetime last_updated
        string last_changed_by
        string location
        string id PK
        datetime date_purchased
        string notes
    }

    app_settings {
        string key PK
        string value
        datetime updated_at
        string updated_by
    }

    asset_field_values {
        string id PK
        string asset_id FK
        string asset_type_field_id FK
        string value
        datetime created_at
        datetime updated_at
    }

    asset_type_fields {
        string id PK
        string asset_type_id FK
        string field_type_id FK
        string name
        string slug
        string description
        boolean is_required
        string default_value
        json options
        json validation_rules
        int display_order
        datetime created_at
        datetime updated_at
    }

    asset_documents {
        string id PK
        string asset_id FK
        string title
        string kind
        string related_date_label
        datetime related_date
        string s3_key
        string url
        string content_type
        int size_bytes
        string uploaded_by
        datetime created_at
        datetime deleted_at
        json metadata
        string asset_type_field_id FK
    }

    field_types {
        string id PK
        string name
        string slug UK
        string description
        boolean has_options
        json validation_rules
        datetime created_at
        datetime updated_at
    }

    users {
        string id PK
        string name
        string userassets
        string favourite_type_names
        string useremail UK
        enum role
        enum status
        string domain
        string invitedById FK
        string expo_push_token
        datetime created_at
        datetime updated_at
    }

    asset_actions {
        string id PK
        string asset_id FK
        enum type
        json data
        string note
        string performed_by FK
        string from_user_id FK
        string to_user_id FK
        datetime occurred_at
    }

    asset_action_details {
        string id PK
        string action_id FK "unique 1:1"
        enum action_type
        datetime date
        string notes
        string summary
        decimal estimated_cost
        enum priority
        string hire_to
        datetime hire_start
        datetime hire_end
        decimal hire_rate
        string hire_project
        string hire_client
        string eol_reason
        string where_location
        string police_report
    }

    tasks {
        string id PK
        string title
        string description
        string category
        string cert_type
        string priority
        string status
        datetime due_date
        string asset_id FK
        string assigned_to_id FK
        string created_by FK
        string completed_by
        datetime completed_at
        string completion_note
        datetime created_at
        datetime updated_at
    }

    asset_deletions {
        string id PK
        string asset_id
        datetime deleted_at
        string deleted_by
        string asset_name
        string asset_type
        string image_url
    }

    registered_domains {
        string id PK
        string domain UK
        string display_name
        datetime created_at
        datetime updated_at
    }
```

## Regenerating

```bash
npm run db:erd        # from inventory-api/
```

It also regenerates automatically on commit when `prisma/schema.prisma` changes
(wired via lint-staged in `package.json`).
