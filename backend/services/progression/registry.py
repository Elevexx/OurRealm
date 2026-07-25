"""Canonical server-side task-type registry.

Every launch task type is registered here with a stable key, category,
and a shared calculation STRATEGY. Multiple task types reuse the same
strategy with different default config — no duplicated logic. Unknown or
retired task types fail safely (never auto-complete).
"""

# strategy -> implemented in services/progression/calculators.py
T = {}


def _reg(key, name, category, strategy, *, config=None, button=None, dest=None,
         progress="numeric", historical=True, unique=None):
    T[key] = {
        "key": key, "name": name, "category": category, "strategy": strategy,
        "default_config": config or {}, "default_button_label": button or "Go",
        "default_destination": dest or "/home", "progress_type": progress,
        "supports_historical": historical, "unique_mode": unique,
    }


# ── Profile tasks ─────────────────────────────────────────────
_reg("profile_picture", "Upload a real profile picture", "profile", "profile_field",
     config={"field": "avatar"}, button="Upload Profile Picture", dest="/profile?edit=avatar", progress="boolean")
_reg("profile_banner", "Upload a real banner", "profile", "profile_field",
     config={"field": "banner"}, button="Upload Banner", dest="/profile?edit=banner", progress="boolean")
_reg("profile_bio", "Complete profile biography", "profile", "profile_field",
     config={"field": "bio", "min_length": 3}, button="Add Bio", dest="/profile?edit=bio", progress="boolean")
_reg("profile_location", "Add a profile location", "profile", "profile_field",
     config={"field": "location"}, button="Add Location", dest="/settings/account", progress="boolean")
_reg("profile_interests", "Add interests", "profile", "profile_field",
     config={"field": "interests", "min_count": 1}, button="Pick Interests", dest="/interests", progress="numeric")
_reg("profile_display_name", "Add a display name", "profile", "profile_field",
     config={"field": "display_name"}, button="Set Display Name", dest="/profile?edit=name", progress="boolean")
_reg("profile_links", "Add profile links", "profile", "profile_field",
     config={"field": "links"}, button="Add Links", dest="/profile", progress="boolean")
_reg("profile_appearance", "Customize profile appearance", "profile", "profile_field",
     config={"field": "appearance"}, button="Customize Profile", dest="/profile", progress="boolean")
_reg("profile_completion_pct", "Complete a percentage of profile fields", "profile", "profile_completion",
     config={"target_pct": 80}, button="Complete Profile", dest="/profile", progress="percentage")

# ── Posting tasks ─────────────────────────────────────────────
_reg("create_post", "Create a post", "posting", "post_count",
     button="Create a Post", dest="/feed")
_reg("create_thought_post", "Create a Thought post", "posting", "post_count",
     config={"media_type": "thought"}, button="Share a Thought", dest="/feed")
_reg("create_image_post", "Upload an image post", "posting", "post_count",
     config={"media_type": "image"}, button="Post a Photo", dest="/feed")
_reg("create_video_post", "Upload a video post", "posting", "post_count",
     config={"media_type": "video"}, button="Post a Video", dest="/feed")
_reg("foryou_eligible_post", "Create a backend-eligible For You post", "posting", "post_count",
     config={"foryou_only": True}, button="Create a Post", dest="/feed")
_reg("post_count", "Create a certain number of posts", "posting", "post_count",
     button="Create Posts", dest="/feed")
_reg("post_unique_days", "Create posts on multiple unique days", "posting", "post_count",
     config={"unique": "day"}, button="Post Today", dest="/feed", unique="day")
_reg("likes_received", "Receive valid likes", "posting", "engagement_received",
     config={"kind": "like"}, button="View Feed", dest="/feed")
_reg("comments_received", "Receive valid comments", "posting", "engagement_received",
     config={"kind": "comment"}, button="View Feed", dest="/feed")
_reg("views_received", "Receive valid views", "posting", "engagement_received",
     config={"kind": "view"}, button="View Feed", dest="/feed")
_reg("unique_engagers", "Receive engagement from unique real users", "posting", "engagement_received",
     config={"kind": "any", "unique": "user"}, button="View Feed", dest="/feed", unique="user")

# ── Fire Power tasks (Likes were replaced by Fire) ────────────
_reg("fire_received", "Receive Fire Power", "posting", "fire_received",
     button="View Feed", dest="/feed")
_reg("fire_unique_supporters", "Receive Fire from unique real users", "posting", "fire_received",
     config={"unique": "user"}, button="View Feed", dest="/feed", unique="user")
_reg("fire_sent", "Send Fire Power to creators", "engagement", "fire_sent",
     button="Explore Feed", dest="/feed")
_reg("fire_unique_creators", "Support unique creators with Fire", "engagement", "fire_sent",
     config={"unique": "user"}, button="Explore Feed", dest="/feed", unique="user")

# ── Social tasks ─────────────────────────────────────────────
_reg("follow_user", "Follow a real user", "social", "friend_count",
     config={"direction": "out"}, button="Find People", dest="/friends", progress="numeric")
_reg("gain_follower", "Gain a real follower", "social", "friend_count",
     config={"direction": "in"}, button="Share Your Profile", dest="/profile", progress="numeric")
_reg("add_friend", "Add a friend", "social", "friend_count",
     config={"direction": "out"}, button="Add Friends", dest="/friends", progress="numeric")
_reg("send_message", "Send a valid message", "social", "messages_sent",
     button="Open Messages", dest="/messages")
_reg("join_group", "Join a group", "social", "group_membership",
     config={"community_type": "group"}, button="Browse Groups", dest="/realms")
_reg("top8_add", "Add users to your Inner Realm", "social", "list_field_count",
     config={"field": "top_8"}, button="Edit Inner Realm", dest="/profile")
_reg("inner8_add", "Add users to your Inner Realm", "social", "list_field_count",
     config={"field": "inner_8"}, button="Edit Inner Realm", dest="/profile")
_reg("inner_realm_complete", "Complete your Inner Realm", "social", "inner_realm_complete",
     button="Edit Inner Realm", dest="/profile", progress="numeric")
_reg("unique_interactions", "Interact with unique real users", "social", "interactions_given",
     config={"unique": "user"}, button="Explore Feed", dest="/feed", unique="user")

# ── Realm tasks ─────────────────────────────────────────────
_reg("join_realm", "Join a Realm", "realm", "group_membership",
     config={"community_type": "realm"}, button="Browse Realms", dest="/realms")
_reg("realm_post", "Create a Realm post", "realm", "realm_activity",
     config={"kind": "post"}, button="Open Realms", dest="/realms")
_reg("realm_poll_vote", "Participate in a Realm poll", "realm", "realm_activity",
     config={"kind": "poll_vote"}, button="Open Realms", dest="/realms")
_reg("realm_message", "Send a Realm message", "realm", "realm_activity",
     config={"kind": "message"}, button="Open Realms", dest="/realms")
_reg("realm_unique_visited", "Visit multiple Realms", "realm", "app_event_count",
     config={"event_key": "realm_visited", "unique": "object"}, button="Browse Realms", dest="/realms", unique="object")
_reg("realm_unique_interacted", "Interact in multiple Realms", "realm", "realm_activity",
     config={"kind": "any", "unique": "object"}, button="Open Realms", dest="/realms", unique="object")
_reg("realm_specific_activity", "Complete Realm-specific activity", "realm", "realm_activity",
     config={"kind": "any", "community_id": None}, button="Open Realm", dest="/realms")

# ── Engagement tasks ─────────────────────────────────────────
_reg("active_days", "Log in on multiple unique days", "engagement", "active_days",
     button="Come Back Tomorrow", dest="/home", unique="day")
_reg("daily_task", "Complete a daily task", "engagement", "app_event_count",
     config={"event_key": "daily_task_completed", "unique": "day"}, button="Open Home", dest="/home", unique="day")
_reg("react_to_post", "React to another real user's post", "engagement", "interactions_given",
     config={"kind": "reaction"}, button="Explore Feed", dest="/feed")
_reg("comment_on_post", "Comment on another real user's post", "engagement", "interactions_given",
     config={"kind": "comment"}, button="Explore Feed", dest="/feed")
_reg("share_post", "Share a valid post", "engagement", "app_event_count",
     config={"event_key": "post_shared", "unique": "object"}, button="Explore Feed", dest="/feed")
_reg("save_post", "Save a post", "engagement", "app_event_count",
     config={"event_key": "post_saved", "unique": "object"}, button="Explore Feed", dest="/feed")
_reg("engagement_combo", "Complete multiple engagement types", "engagement", "engagement_combo",
     config={"kinds": ["reaction", "comment"]}, button="Explore Feed", dest="/feed")

# ── Platform tasks ───────────────────────────────────────────
_reg("complete_tutorial", "Complete the tutorial", "platform", "tutorial_complete",
     button="Open Tutorial", dest="/home?tutorial=1", progress="boolean")
_reg("select_mode", "Select a Mode", "platform", "app_event_count",
     config={"event_key": "mode_selected"}, button="Explore Modes", dest="/modes", progress="boolean")
_reg("customize_widget", "Customize a widget", "platform", "widget_customized",
     button="Edit Widgets", dest="/profile", progress="boolean")
_reg("visit_portals", "Visit the Portals page", "platform", "app_event_count",
     config={"event_key": "portals_visited"}, button="Open Portals", dest="/portals", progress="boolean")
_reg("onboarding_step", "Complete an onboarding step", "platform", "app_event_count",
     config={"event_key": "onboarding_step"}, button="Continue Setup", dest="/home", progress="numeric")
_reg("profile_setup", "Complete profile setup", "platform", "profile_completion",
     config={"target_pct": 100}, button="Finish Profile", dest="/profile", progress="percentage")
_reg("use_feature", "Use an available platform feature", "platform", "app_event_count",
     config={"event_key": "feature_used", "object_key": None}, button="Explore", dest="/home", progress="boolean")

# ── Custom tasks (safe declarative rules only) ───────────────
_reg("custom_event", "Custom: approved event rule", "custom", "app_event_count",
     config={"event_key": None, "unique": None, "operator": ">="}, button="Go", dest="/home")
_reg("manual_approval", "Custom: manual founder approval", "custom", "manual_approval",
     button="Request Review", dest="/profile", progress="boolean", historical=False)

# Allowlisted app-event keys accepted from the authenticated client or
# signed internal API. Unknown keys are rejected.
ALLOWED_APP_EVENT_KEYS = {
    "realm_visited", "portals_visited", "mode_selected", "post_shared",
    "post_saved", "daily_task_completed", "onboarding_step", "feature_used",
    "tutorial_resumed",
}
ALLOWED_OPERATORS = {">=", ">", "==", "<=", "<"}


def get_task_type(key: str):
    return T.get(key)


def list_task_types():
    return [
        {k: v[k] for k in ("key", "name", "category", "strategy", "default_config",
                           "default_button_label", "default_destination",
                           "progress_type", "supports_historical", "unique_mode")}
        for v in T.values()
    ]
