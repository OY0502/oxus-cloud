export const pipelineData = {
  columns: [
    { id: "new-lead", title: "New Lead" },
    { id: "scoping", title: "Scoping" },
    { id: "proposal", title: "Proposal" },
    { id: "won", title: "Won" }
  ],
  cards: [
    { id: "c1", columnId: "new-lead", company: "Northwind Studio", contact: "Mara Lindqvist", value: 8500, tags: ["E-commerce", "React"], avatar: "https://i.pravatar.cc/150?u=11" },
    { id: "c2", columnId: "new-lead", company: "Lumen Health", contact: "Devon Carter", value: 14000, tags: ["Healthcare", "Next.js"], avatar: "https://i.pravatar.cc/150?u=12" },
    { id: "c3", columnId: "new-lead", company: "Brightside Coffee", contact: "Olivia Tan", value: 6200, tags: ["Branding", "Webflow"], avatar: "https://i.pravatar.cc/150?u=13" },
    { id: "c4", columnId: "scoping", company: "Globex Logistics", contact: "Jane Whitfield", value: 22000, tags: ["SaaS", "Dashboard"], avatar: "https://i.pravatar.cc/150?u=14" },
    { id: "c5", columnId: "scoping", company: "Atlas Fintech", contact: "Marcus Reid", value: 31000, tags: ["Fintech", "Mobile"], avatar: "https://i.pravatar.cc/150?u=15" },
    { id: "c6", columnId: "scoping", company: "Verdant Farms", contact: "Priya Nair", value: 9800, tags: ["Marketing", "CMS"], avatar: "https://i.pravatar.cc/150?u=16" },
    { id: "c7", columnId: "proposal", company: "Initech Labs", contact: "Bob Sherman", value: 18500, tags: ["Platform", "React"], avatar: "https://i.pravatar.cc/150?u=17" },
    { id: "c8", columnId: "proposal", company: "Cobalt Media", contact: "Sofia Marin", value: 12400, tags: ["Editorial", "Design"], avatar: "https://i.pravatar.cc/150?u=18" },
    { id: "c9", columnId: "won", company: "Umbrella Group", contact: "Alice Williams", value: 42000, tags: ["Enterprise", "Custom"], avatar: "https://i.pravatar.cc/150?u=19" },
    { id: "c10", columnId: "won", company: "Pulse Robotics", contact: "Kenji Watanabe", value: 27500, tags: ["IoT", "Realtime"], avatar: "https://i.pravatar.cc/150?u=20" },
    { id: "c11", columnId: "won", company: "Harbor & Co.", contact: "Grace Bennett", value: 15600, tags: ["E-commerce", "Shopify"], avatar: "https://i.pravatar.cc/150?u=21" }
  ]
};

export const quotesData = [
  { id: "q1", number: "QT-2026-014", client: "Atlas Fintech", project: "Mobile Banking App", amount: 31000, status: "sent", date: "2026-06-04" },
  { id: "q2", number: "QT-2026-013", client: "Pulse Robotics", project: "Realtime Telemetry Portal", amount: 27500, status: "accepted", date: "2026-06-02" },
  { id: "q3", number: "QT-2026-012", client: "Globex Logistics", project: "SaaS Operations Dashboard", amount: 22000, status: "sent", date: "2026-05-29" },
  { id: "q4", number: "QT-2026-011", client: "Initech Labs", project: "Internal Platform Rebuild", amount: 18500, status: "draft", date: "2026-05-27" },
  { id: "q5", number: "QT-2026-010", client: "Harbor & Co.", project: "Shopify Storefront", amount: 15600, status: "accepted", date: "2026-05-22" },
  { id: "q6", number: "QT-2026-009", client: "Lumen Health", project: "Patient Booking System", amount: 14000, status: "sent", date: "2026-05-18" },
  { id: "q7", number: "QT-2026-008", client: "Cobalt Media", project: "Editorial CMS", amount: 12400, status: "declined", date: "2026-05-14" },
  { id: "q8", number: "QT-2026-007", client: "Verdant Farms", project: "Marketing Website", amount: 9800, status: "accepted", date: "2026-05-09" },
  { id: "q9", number: "QT-2026-006", client: "Northwind Studio", project: "E-commerce Redesign", amount: 8500, status: "draft", date: "2026-05-05" },
  { id: "q10", number: "QT-2026-005", client: "Brightside Coffee", project: "Brand & Landing Page", amount: 6200, status: "declined", date: "2026-05-01" }
];

export const projectsData = [
  { id: "p1", name: "Mobile Banking App", client: "Atlas Fintech", assignees: ["https://i.pravatar.cc/150?u=31", "https://i.pravatar.cc/150?u=32"], status: "in-progress", priority: "high", startDate: "2026-05-12", deadline: "2026-08-20" },
  { id: "p2", name: "Realtime Telemetry Portal", client: "Pulse Robotics", assignees: ["https://i.pravatar.cc/150?u=33"], status: "in-progress", priority: "high", startDate: "2026-05-20", deadline: "2026-07-15" },
  { id: "p3", name: "SaaS Operations Dashboard", client: "Globex Logistics", assignees: ["https://i.pravatar.cc/150?u=34", "https://i.pravatar.cc/150?u=35"], status: "planning", priority: "medium", startDate: "2026-06-10", deadline: "2026-09-01" },
  { id: "p4", name: "Shopify Storefront", client: "Harbor & Co.", assignees: ["https://i.pravatar.cc/150?u=36"], status: "in-progress", priority: "medium", startDate: "2026-05-01", deadline: "2026-06-28" },
  { id: "p5", name: "Patient Booking System", client: "Lumen Health", assignees: ["https://i.pravatar.cc/150?u=37", "https://i.pravatar.cc/150?u=31"], status: "in-progress", priority: "high", startDate: "2026-04-15", deadline: "2026-07-30" },
  { id: "p6", name: "Marketing Website", client: "Verdant Farms", assignees: ["https://i.pravatar.cc/150?u=32"], status: "completed", priority: "low", startDate: "2026-03-10", deadline: "2026-05-12" },
  { id: "p7", name: "Editorial CMS", client: "Cobalt Media", assignees: ["https://i.pravatar.cc/150?u=33", "https://i.pravatar.cc/150?u=34"], status: "on-hold", priority: "medium", startDate: "2026-04-01", deadline: "2026-06-15" },
  { id: "p8", name: "E-commerce Redesign", client: "Northwind Studio", assignees: ["https://i.pravatar.cc/150?u=35"], status: "planning", priority: "low", startDate: "2026-06-20", deadline: "2026-09-20" }
];

export const teamData = [
  { id: "t1", name: "Elena Brooks", role: "Lead Frontend Engineer", avatar: "https://i.pravatar.cc/150?u=31", status: "active", rate: 85, location: "Lisbon, Portugal" },
  { id: "t2", name: "Marcus Reid", role: "Backend Engineer", avatar: "https://i.pravatar.cc/150?u=32", status: "active", rate: 78, location: "Toronto, Canada" },
  { id: "t3", name: "Aiko Tanaka", role: "Product Designer", avatar: "https://i.pravatar.cc/150?u=33", status: "active", rate: 72, location: "Berlin, Germany" },
  { id: "t4", name: "Daniel Osei", role: "Full-stack Developer", avatar: "https://i.pravatar.cc/150?u=34", status: "active", rate: 80, location: "Accra, Ghana" },
  { id: "t5", name: "Sofia Marin", role: "Motion Designer", avatar: "https://i.pravatar.cc/150?u=35", status: "inactive", rate: 65, location: "Barcelona, Spain" },
  { id: "t6", name: "Liam Walsh", role: "DevOps Engineer", avatar: "https://i.pravatar.cc/150?u=36", status: "active", rate: 90, location: "Dublin, Ireland" },
  { id: "t7", name: "Priya Nair", role: "QA Engineer", avatar: "https://i.pravatar.cc/150?u=37", status: "inactive", rate: 58, location: "Bangalore, India" }
];

export const contactsData = [
  { id: "ct1", name: "Mara Lindqvist", type: "client", company: "Northwind Studio", email: "mara@northwind.studio", phone: "+46 70 123 4567" },
  { id: "ct2", name: "Devon Carter", type: "client", company: "Lumen Health", email: "devon@lumenhealth.io", phone: "+1 555 204 8890" },
  { id: "ct3", name: "Jane Whitfield", type: "client", company: "Globex Logistics", email: "jane@globex.com", phone: "+1 555 987 6543" },
  { id: "ct4", name: "Marcus Reid", type: "contractor", company: "Freelance", email: "marcus.reid@proton.me", phone: "+1 416 555 0192" },
  { id: "ct5", name: "Aiko Tanaka", type: "contractor", company: "Freelance", email: "aiko@studio-tanaka.jp", phone: "+49 30 555 7781" },
  { id: "ct6", name: "Alice Williams", type: "client", company: "Umbrella Group", email: "alice@umbrella.com", phone: "+1 555 555 5555" },
  { id: "ct7", name: "Kenji Watanabe", type: "client", company: "Pulse Robotics", email: "kenji@pulserobotics.ai", phone: "+81 3 5555 2210" },
  { id: "ct8", name: "Grace Bennett", type: "client", company: "Harbor & Co.", email: "grace@harborandco.com", phone: "+44 20 7946 0102" },
  { id: "ct9", name: "Sofia Marin", type: "contractor", company: "Freelance", email: "sofia@marin.design", phone: "+34 600 123 456" },
  { id: "ct10", name: "Tomas Vidal", type: "person", company: "Stripe", email: "tomas.vidal@stripe.com", phone: "+1 555 880 4412" },
  { id: "ct11", name: "Olivia Tan", type: "client", company: "Brightside Coffee", email: "olivia@brightside.coffee", phone: "+65 8123 4567" },
  { id: "ct12", name: "Reuben Marsh", type: "other", company: "Vercel", email: "reuben@vercel.com", phone: "+1 555 661 7700" }
];

export const invoicesData = [
  { id: "inv1", number: "INV-2026-018", client: "Atlas Fintech", amount: 12500, status: "pending", date: "2026-06-01", dueDate: "2026-06-20" },
  { id: "inv2", number: "INV-2026-017", client: "Pulse Robotics", amount: 9200, status: "pending", date: "2026-05-28", dueDate: "2026-06-18" },
  { id: "inv3", number: "INV-2026-016", client: "Initech Labs", amount: 7400, status: "overdue", date: "2026-05-02", dueDate: "2026-05-22" },
  { id: "inv4", number: "INV-2026-015", client: "Lumen Health", amount: 5600, status: "overdue", date: "2026-04-25", dueDate: "2026-05-15" },
  { id: "inv5", number: "INV-2026-014", client: "Harbor & Co.", amount: 8300, status: "pending", date: "2026-06-03", dueDate: "2026-06-25" },
  { id: "inv6", number: "INV-2026-013", client: "Globex Logistics", amount: 11000, status: "paid", date: "2026-05-15", dueDate: "2026-05-30" },
  { id: "inv7", number: "INV-2026-012", client: "Verdant Farms", amount: 9800, status: "paid", date: "2026-05-10", dueDate: "2026-05-24" },
  { id: "inv8", number: "INV-2026-011", client: "Umbrella Group", amount: 21000, status: "paid", date: "2026-05-04", dueDate: "2026-05-18" },
  { id: "inv9", number: "INV-2026-010", client: "Cobalt Media", amount: 6200, status: "paid", date: "2026-04-28", dueDate: "2026-05-12" },
  { id: "inv10", number: "INV-2026-009", client: "Northwind Studio", amount: 4500, status: "paid", date: "2026-04-20", dueDate: "2026-05-04" }
];

export const financeData = [
  { month: "Jul", income: 34000, expenses: 19000, net: 15000 },
  { month: "Aug", income: 38500, expenses: 21000, net: 17500 },
  { month: "Sep", income: 32000, expenses: 18500, net: 13500 },
  { month: "Oct", income: 41000, expenses: 23000, net: 18000 },
  { month: "Nov", income: 45500, expenses: 24500, net: 21000 },
  { month: "Dec", income: 52000, expenses: 28000, net: 24000 },
  { month: "Jan", income: 39000, expenses: 22000, net: 17000 },
  { month: "Feb", income: 43000, expenses: 23500, net: 19500 },
  { month: "Mar", income: 47500, expenses: 25000, net: 22500 },
  { month: "Apr", income: 44000, expenses: 24000, net: 20000 },
  { month: "May", income: 51000, expenses: 27000, net: 24000 },
  { month: "Jun", income: 56000, expenses: 29500, net: 26500 }
];
