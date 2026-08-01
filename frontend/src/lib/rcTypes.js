import { Home, Briefcase, Users, Building2, Globe2, HeartHandshake, Boxes, User, GraduationCap, Church, Trophy, HandHeart } from "lucide-react";

// Responsibility Center — shared type catalogue (Phase 1).
export const RC_TYPES = [
  { id: "personal",     label: "Personal",     Icon: User,           color: "#5AB2FF", desc: "Your own goals, routines and personal responsibilities" },
  { id: "family",       label: "Family",       Icon: HeartHandshake, color: "#F4C84A", desc: "Coordinate your household's people and responsibilities" },
  { id: "household",    label: "Household",    Icon: Home,           color: "#7BD88F", desc: "Roommates, shared living, chores and duties" },
  { id: "education",    label: "Education",    Icon: GraduationCap,  color: "#2EA0FF", desc: "Homeschool, classes, tutoring and learning groups" },
  { id: "business",     label: "Business",     Icon: Briefcase,      color: "#5AB2FF", desc: "Run a company's people, roles and accountability" },
  { id: "team",         label: "Team",         Icon: Users,          color: "#C26BFF", desc: "A crew, squad, or project team with clear roles" },
  { id: "organization", label: "Organization", Icon: Building2,      color: "#FF8A5A", desc: "Clubs, nonprofits, and structured groups" },
  { id: "church",       label: "Church",       Icon: Church,         color: "#F4C84A", desc: "Ministries, services, volunteers and events" },
  { id: "sports",       label: "Sports Team",  Icon: Trophy,         color: "#10E670", desc: "Rosters, practices, games and team duties" },
  { id: "community",    label: "Community",    Icon: Globe2,         color: "#4DD6C1", desc: "A wider community with shared responsibilities" },
  { id: "volunteer",    label: "Volunteer Group", Icon: HandHeart,   color: "#FF8AC2", desc: "Coordinate volunteers, shifts and outreach" },
  { id: "other",        label: "Other",        Icon: Boxes,          color: "#9AA7BD", desc: "Any other structure — define it your way" },
];

export const rcTypeMeta = (id) => RC_TYPES.find((t) => t.id === id) || RC_TYPES[RC_TYPES.length - 1];

export const ROLE_COLORS = {
  owner: "#F4C84A", admin: "#C26BFF", manager: "#5AB2FF", member: "#9AA7BD",
};
