export const pipelineData = {
  columns: [
    { id: "new-lead", title: "New Lead", description: "Recently captured leads" },
    { id: "scoping", title: "Scoping", description: "Defining requirements" },
    { id: "proposal", title: "Proposal", description: "Awaiting client sign-off" },
    { id: "won", title: "Won", description: "Closed deals" },
    { id: "archived", title: "Archived", description: "No longer active" }
  ],
  cards: [
    { id: "c1", columnId: "new-lead", company: "Northwind Studio", contact: "Mara Lindqvist", projectType: "E-commerce", budget: 8500, ownerAvatar: "https://i.pravatar.cc/150?u=11", ageInStage: 2, nextAction: "Follow-up email", tags: ["E-commerce", "React"], urgency: "normal" },
    { id: "c2", columnId: "new-lead", company: "Lumen Health", contact: "Devon Carter", projectType: "Web App", budget: 14000, ownerAvatar: "https://i.pravatar.cc/150?u=12", ageInStage: 5, nextAction: "Schedule call", tags: ["Healthcare", "Next.js"], urgency: "high" },
    { id: "c3", columnId: "new-lead", company: "Brightside Coffee", contact: "Olivia Tan", projectType: "Branding", budget: 6200, ownerAvatar: "https://i.pravatar.cc/150?u=13", ageInStage: 1, nextAction: "Send portfolio", tags: ["Branding", "Webflow"], urgency: "low" },
    { id: "c4", columnId: "scoping", company: "Globex Logistics", contact: "Jane Whitfield", projectType: "Dashboard", budget: 22000, ownerAvatar: "https://i.pravatar.cc/150?u=14", ageInStage: 12, nextAction: "Finalize requirements", tags: ["SaaS", "Dashboard"], urgency: "high" },
    { id: "c5", columnId: "scoping", company: "Atlas Fintech", contact: "Marcus Reid", projectType: "Mobile App", budget: 31000, ownerAvatar: "https://i.pravatar.cc/150?u=15", ageInStage: 8, nextAction: "Technical review", tags: ["Fintech", "Mobile"], urgency: "normal" },
    { id: "c6", columnId: "scoping", company: "Verdant Farms", contact: "Priya Nair", projectType: "Website", budget: 9800, ownerAvatar: "https://i.pravatar.cc/150?u=16", ageInStage: 4, nextAction: "Review design", tags: ["Marketing", "CMS"], urgency: "low" },
    { id: "c7", columnId: "proposal", company: "Initech Labs", contact: "Bob Sherman", projectType: "Platform", budget: 18500, ownerAvatar: "https://i.pravatar.cc/150?u=17", ageInStage: 15, nextAction: "Awaiting signature", tags: ["Platform", "React"], urgency: "high" },
    { id: "c8", columnId: "proposal", company: "Cobalt Media", contact: "Sofia Marin", projectType: "CMS", budget: 12400, ownerAvatar: "https://i.pravatar.cc/150?u=18", ageInStage: 7, nextAction: "Follow-up", tags: ["Editorial", "Design"], urgency: "normal" },
    { id: "c9", columnId: "won", company: "Umbrella Group", contact: "Alice Williams", projectType: "Enterprise Tool", budget: 42000, ownerAvatar: "https://i.pravatar.cc/150?u=19", ageInStage: 1, nextAction: "Kickoff meeting", tags: ["Enterprise", "Custom"], urgency: "normal" },
    { id: "c10", columnId: "won", company: "Pulse Robotics", contact: "Kenji Watanabe", projectType: "Portal", budget: 27500, ownerAvatar: "https://i.pravatar.cc/150?u=20", ageInStage: 3, nextAction: "Resource allocation", tags: ["IoT", "Realtime"], urgency: "high" },
    { id: "c11", columnId: "won", company: "Harbor & Co.", contact: "Grace Bennett", projectType: "Storefront", budget: 15600, ownerAvatar: "https://i.pravatar.cc/150?u=21", ageInStage: 2, nextAction: "Setup repo", tags: ["E-commerce", "Shopify"], urgency: "normal" },
    { id: "c12", columnId: "archived", company: "Solaris Media", contact: "Tom Baxter", projectType: "Rebrand", budget: 7200, ownerAvatar: "https://i.pravatar.cc/150?u=22", ageInStage: 45, nextAction: "Closed — budget cut", tags: ["Branding", "Design"], urgency: "low" },
    { id: "c13", columnId: "archived", company: "Delta Ventures", contact: "Rina Chowdhury", projectType: "Landing Page", budget: 3800, ownerAvatar: "https://i.pravatar.cc/150?u=23", ageInStage: 30, nextAction: "Closed — no response", tags: ["Marketing", "Webflow"], urgency: "low" },
    { id: "c14", columnId: "archived", company: "Epoch Systems", contact: "Chris Nguyen", projectType: "API Integration", budget: 11000, ownerAvatar: "https://i.pravatar.cc/150?u=24", ageInStage: 60, nextAction: "Closed — competitor chosen", tags: ["API", "Node.js"], urgency: "low" }
  ]
};

export const quotesData = [
  { id: "q1", number: "QT-2026-014", client: "Atlas Fintech", project: "Mobile Banking App", owner: "Elena Brooks", amount: 31000, status: "sent", date: "2026-06-04", conversion: 60 },
  { id: "q2", number: "QT-2026-013", client: "Pulse Robotics", project: "Realtime Telemetry Portal", owner: "Marcus Reid", amount: 27500, status: "accepted", date: "2026-06-02", conversion: 100 },
  { id: "q3", number: "QT-2026-012", client: "Globex Logistics", project: "SaaS Operations Dashboard", owner: "Elena Brooks", amount: 22000, status: "sent", date: "2026-05-29", conversion: 80 },
  { id: "q4", number: "QT-2026-011", client: "Initech Labs", project: "Internal Platform Rebuild", owner: "Daniel Osei", amount: 18500, status: "draft", date: "2026-05-27", conversion: 40 },
  { id: "q5", number: "QT-2026-010", client: "Harbor & Co.", project: "Shopify Storefront", owner: "Liam Walsh", amount: 15600, status: "accepted", date: "2026-05-22", conversion: 100 },
  { id: "q6", number: "QT-2026-009", client: "Lumen Health", project: "Patient Booking System", owner: "Elena Brooks", amount: 14000, status: "sent", date: "2026-05-18", conversion: 75 },
  { id: "q7", number: "QT-2026-008", client: "Cobalt Media", project: "Editorial CMS", owner: "Aiko Tanaka", amount: 12400, status: "declined", date: "2026-05-14", conversion: 0 },
  { id: "q8", number: "QT-2026-007", client: "Verdant Farms", project: "Marketing Website", owner: "Daniel Osei", amount: 9800, status: "accepted", date: "2026-05-09", conversion: 100 },
  { id: "q9", number: "QT-2026-006", client: "Northwind Studio", project: "E-commerce Redesign", owner: "Elena Brooks", amount: 8500, status: "draft", date: "2026-05-05", conversion: 20 },
  { id: "q10", number: "QT-2026-005", client: "Brightside Coffee", project: "Brand & Landing Page", owner: "Aiko Tanaka", amount: 6200, status: "declined", date: "2026-05-01", conversion: 0 }
];

export const projectsData = [
  { id: "p1", name: "Mobile Banking App", client: "Atlas Fintech", assignees: ["https://i.pravatar.cc/150?u=31", "https://i.pravatar.cc/150?u=32"], status: "in-progress", priority: "high", startDate: "2026-05-12", deadline: "2026-08-20", progress: 45, budget: 31000, risk: "low", health: "on-track" },
  { id: "p2", name: "Realtime Telemetry Portal", client: "Pulse Robotics", assignees: ["https://i.pravatar.cc/150?u=33"], status: "in-progress", priority: "high", startDate: "2026-05-20", deadline: "2026-07-15", progress: 65, budget: 27500, risk: "medium", health: "at-risk" },
  { id: "p3", name: "SaaS Operations Dashboard", client: "Globex Logistics", assignees: ["https://i.pravatar.cc/150?u=34", "https://i.pravatar.cc/150?u=35"], status: "planning", priority: "medium", startDate: "2026-06-10", deadline: "2026-09-01", progress: 10, budget: 22000, risk: "low", health: "on-track" },
  { id: "p4", name: "Shopify Storefront", client: "Harbor & Co.", assignees: ["https://i.pravatar.cc/150?u=36"], status: "in-progress", priority: "medium", startDate: "2026-05-01", deadline: "2026-06-28", progress: 85, budget: 15600, risk: "high", health: "off-track" },
  { id: "p5", name: "Patient Booking System", client: "Lumen Health", assignees: ["https://i.pravatar.cc/150?u=37", "https://i.pravatar.cc/150?u=31"], status: "in-progress", priority: "high", startDate: "2026-04-15", deadline: "2026-07-30", progress: 55, budget: 14000, risk: "low", health: "on-track" },
  { id: "p6", name: "Marketing Website", client: "Verdant Farms", assignees: ["https://i.pravatar.cc/150?u=32"], status: "completed", priority: "low", startDate: "2026-03-10", deadline: "2026-05-12", progress: 100, budget: 9800, risk: "none", health: "on-track" },
  { id: "p7", name: "Editorial CMS", client: "Cobalt Media", assignees: ["https://i.pravatar.cc/150?u=33", "https://i.pravatar.cc/150?u=34"], status: "on-hold", priority: "medium", startDate: "2026-04-01", deadline: "2026-06-15", progress: 30, budget: 12400, risk: "high", health: "off-track" },
  { id: "p8", name: "E-commerce Redesign", client: "Northwind Studio", assignees: ["https://i.pravatar.cc/150?u=35"], status: "planning", priority: "low", startDate: "2026-06-20", deadline: "2026-09-20", progress: 0, budget: 8500, risk: "low", health: "on-track" }
];

export const teamData = [
  { id: "t1", name: "Elena Brooks", role: "Lead Frontend", avatar: "https://i.pravatar.cc/150?u=31", status: "active", rate: 85, location: "Lisbon, Portugal", stack: ["React", "TypeScript", "Tailwind"], availability: "full", activeProjects: 3, unpaidInvoices: 2, notes: "Top performer, ready for next lead role." },
  { id: "t2", name: "Marcus Reid", role: "Backend Engineer", avatar: "https://i.pravatar.cc/150?u=32", status: "active", rate: 78, location: "Toronto, Canada", stack: ["Node.js", "PostgreSQL", "Go"], availability: "partial", activeProjects: 2, unpaidInvoices: 0, notes: "Expert in API optimization." },
  { id: "t3", name: "Aiko Tanaka", role: "Product Designer", avatar: "https://i.pravatar.cc/150?u=33", status: "active", rate: 72, location: "Berlin, Germany", stack: ["Figma", "Framer", "CSS"], availability: "full", activeProjects: 2, unpaidInvoices: 1, notes: "Needs more challenging UI work." },
  { id: "t4", name: "Daniel Osei", role: "Full-stack Developer", avatar: "https://i.pravatar.cc/150?u=34", status: "active", rate: 80, location: "Accra, Ghana", stack: ["Next.js", "Prisma", "AWS"], availability: "busy", activeProjects: 4, unpaidInvoices: 0, notes: "Overloaded this month, avoid new assignments." },
  { id: "t5", name: "Sofia Marin", role: "Motion Designer", avatar: "https://i.pravatar.cc/150?u=35", status: "inactive", rate: 65, location: "Barcelona, Spain", stack: ["After Effects", "Lottie", "Framer"], availability: "unavailable", activeProjects: 0, unpaidInvoices: 0, notes: "On sabbatical until August." },
  { id: "t6", name: "Liam Walsh", role: "DevOps Engineer", avatar: "https://i.pravatar.cc/150?u=36", status: "active", rate: 90, location: "Dublin, Ireland", stack: ["Kubernetes", "Docker", "Terraform"], availability: "partial", activeProjects: 1, unpaidInvoices: 3, notes: "Handling all infrastructure migrations." },
  { id: "t7", name: "Priya Nair", role: "QA Engineer", avatar: "https://i.pravatar.cc/150?u=37", status: "inactive", rate: 58, location: "Bangalore, India", stack: ["Cypress", "Playwright", "Jest"], availability: "unavailable", activeProjects: 0, unpaidInvoices: 0, notes: "Transitioning out." }
];

export const contactsData = [
  { id: "ct1", name: "Mara Lindqvist", type: "Client", company: "Northwind Studio", email: "mara@northwind.studio", phone: "+46 70 123 4567", lastContact: "2 days ago", relationshipStrength: "strong", source: "Referral", notes: "Prefers async communication." },
  { id: "ct2", name: "Devon Carter", type: "Client", company: "Lumen Health", email: "devon@lumenhealth.io", phone: "+1 555 204 8890", lastContact: "1 week ago", relationshipStrength: "medium", source: "Inbound", notes: "Very detail-oriented." },
  { id: "ct3", name: "Jane Whitfield", type: "Lead", company: "Globex Logistics", email: "jane@globex.com", phone: "+1 555 987 6543", lastContact: "Yesterday", relationshipStrength: "new", source: "Conference", notes: "High potential deal." },
  { id: "ct4", name: "Marcus Reid", type: "Contractor", company: "Freelance", email: "marcus.reid@proton.me", phone: "+1 416 555 0192", lastContact: "Today", relationshipStrength: "strong", source: "Upwork", notes: "Reliable backend dev." },
  { id: "ct5", name: "Aiko Tanaka", type: "Contractor", company: "Freelance", email: "aiko@studio-tanaka.jp", phone: "+49 30 555 7781", lastContact: "3 days ago", relationshipStrength: "strong", source: "Dribbble", notes: "Great aesthetic sense." },
  { id: "ct6", name: "Alice Williams", type: "Partner", company: "Umbrella Group", email: "alice@umbrella.com", phone: "+1 555 555 5555", lastContact: "2 weeks ago", relationshipStrength: "medium", source: "Direct", notes: "Strategic partnership." },
  { id: "ct7", name: "Kenji Watanabe", type: "Client", company: "Pulse Robotics", email: "kenji@pulserobotics.ai", phone: "+81 3 5555 2210", lastContact: "1 month ago", relationshipStrength: "strong", source: "Referral", notes: "Loyal customer." },
  { id: "ct8", name: "Grace Bennett", type: "Client", company: "Harbor & Co.", email: "grace@harborandco.com", phone: "+44 20 7946 0102", lastContact: "Today", relationshipStrength: "medium", source: "Inbound", notes: "Needs handholding." },
  { id: "ct9", name: "Sofia Marin", type: "Contractor", company: "Freelance", email: "sofia@marin.design", phone: "+34 600 123 456", lastContact: "1 month ago", relationshipStrength: "weak", source: "Agency", notes: "Currently unavailable." },
  { id: "ct10", name: "Tomas Vidal", type: "Vendor", company: "Stripe", email: "tomas.vidal@stripe.com", phone: "+1 555 880 4412", lastContact: "3 months ago", relationshipStrength: "medium", source: "Vendor", notes: "Account manager." },
  { id: "ct11", name: "Olivia Tan", type: "Lead", company: "Brightside Coffee", email: "olivia@brightside.coffee", phone: "+65 8123 4567", lastContact: "4 days ago", relationshipStrength: "new", source: "Instagram", notes: "Looking for complete rebrand." },
  { id: "ct12", name: "Reuben Marsh", type: "Vendor", company: "Vercel", email: "reuben@vercel.com", phone: "+1 555 661 7700", lastContact: "2 months ago", relationshipStrength: "strong", source: "Vendor", notes: "Enterprise rep." }
];

export const invoicesData = [
  // Drafts
  { id: "inv-d1", number: "INV-2026-024", client: "Cobalt Media", project: "Editorial CMS", amount: 14800, amountPaid: 0, status: "draft", issueDate: "2026-06-12", dueDate: "2026-07-12", paidDate: null, paymentMethod: null, owner: "Aiko Tanaka", lastReminder: null, stripeStatus: "Draft", lineItems: [{ description: "Editorial CMS Build", amount: 14800 }] },
  { id: "inv-d2", number: "INV-2026-023", client: "Northwind Studio", project: "E-commerce Redesign", amount: 8500, amountPaid: 0, status: "draft", issueDate: "2026-06-14", dueDate: "2026-07-14", paidDate: null, paymentMethod: null, owner: "Elena Brooks", lastReminder: null, stripeStatus: "Draft", lineItems: [{ description: "Design System Audit", amount: 8500 }] },
  // Sent
  { id: "inv-s1", number: "INV-2026-022", client: "Globex Logistics", project: "SaaS Operations Dashboard", amount: 22000, amountPaid: 0, status: "sent", issueDate: "2026-06-10", dueDate: "2026-06-30", paidDate: null, paymentMethod: null, owner: "Daniel Osei", lastReminder: null, stripeStatus: "Awaiting payment", lineItems: [{ description: "Discovery & Setup", amount: 22000 }] },
  { id: "inv-s2", number: "INV-2026-021", client: "Atlas Fintech", project: "Mobile Banking App", amount: 12500, amountPaid: 0, status: "sent", issueDate: "2026-06-01", dueDate: "2026-06-20", paidDate: null, paymentMethod: null, owner: "Elena Brooks", lastReminder: null, stripeStatus: "Awaiting payment", lineItems: [{ description: "Development Milestone 1", amount: 12500 }] },
  { id: "inv-s3", number: "INV-2026-020", client: "Pulse Robotics", project: "Realtime Telemetry Portal", amount: 9200, amountPaid: 0, status: "sent", issueDate: "2026-05-28", dueDate: "2026-06-18", paidDate: null, paymentMethod: null, owner: "Marcus Reid", lastReminder: "2 days ago", stripeStatus: "Awaiting payment", lineItems: [{ description: "UI Design Phase", amount: 9200 }] },
  // Viewed
  { id: "inv-v1", number: "INV-2026-019", client: "Harbor & Co.", project: "Shopify Storefront", amount: 8300, amountPaid: 0, status: "viewed", issueDate: "2026-06-03", dueDate: "2026-06-21", paidDate: null, paymentMethod: null, owner: "Liam Walsh", lastReminder: null, stripeStatus: "Opened", lineItems: [{ description: "Monthly Maintenance", amount: 8300 }] },
  { id: "inv-v2", number: "INV-2026-018", client: "Lumen Health", project: "Patient Booking System", amount: 6400, amountPaid: 0, status: "viewed", issueDate: "2026-06-05", dueDate: "2026-06-19", paidDate: null, paymentMethod: null, owner: "Elena Brooks", lastReminder: "1 day ago", stripeStatus: "Opened", lineItems: [{ description: "Sprint 2 Delivery", amount: 6400 }] },
  // Partially paid
  { id: "inv-pp1", number: "INV-2026-017", client: "Initech Labs", project: "API Platform", amount: 18000, amountPaid: 9000, status: "partial", issueDate: "2026-05-20", dueDate: "2026-06-22", paidDate: null, paymentMethod: "Stripe", owner: "Marcus Reid", lastReminder: null, stripeStatus: "Partially paid", lineItems: [{ description: "Platform Build (50% deposit)", amount: 18000 }] },
  { id: "inv-pp2", number: "INV-2026-016", client: "Verdant Farms", project: "Marketing Website Ph. 2", amount: 7600, amountPaid: 3800, status: "partial", issueDate: "2026-05-25", dueDate: "2026-06-25", paidDate: null, paymentMethod: "Bank Transfer", owner: "Aiko Tanaka", lastReminder: null, stripeStatus: "Partially paid", lineItems: [{ description: "Phase 2 Development", amount: 7600 }] },
  // Overdue
  { id: "inv-o1", number: "INV-2026-015", client: "Initech Labs", project: "Consulting Retainer", amount: 7400, amountPaid: 0, status: "overdue", issueDate: "2026-05-02", dueDate: "2026-05-22", paidDate: null, paymentMethod: null, owner: "Marcus Reid", lastReminder: "5 days ago", stripeStatus: "Requires action", lineItems: [{ description: "Consulting Retainer", amount: 7400 }] },
  { id: "inv-o2", number: "INV-2026-014", client: "Lumen Health", project: "Server Setup & Config", amount: 5600, amountPaid: 0, status: "overdue", issueDate: "2026-04-25", dueDate: "2026-05-15", paidDate: null, paymentMethod: null, owner: "Liam Walsh", lastReminder: "1 week ago", stripeStatus: "Requires action", lineItems: [{ description: "Server Setup & Config", amount: 5600 }] },
  { id: "inv-o3", number: "INV-2026-013", client: "Pulse Robotics", project: "Hardware Integration", amount: 10300, amountPaid: 0, status: "overdue", issueDate: "2026-04-30", dueDate: "2026-05-28", paidDate: null, paymentMethod: null, owner: "Daniel Osei", lastReminder: "3 days ago", stripeStatus: "Requires action", lineItems: [{ description: "Hardware Integration", amount: 10300 }] },
  // Paid
  { id: "inv-p1", number: "INV-2026-012", client: "Globex Logistics", project: "SaaS Operations Dashboard", amount: 11000, amountPaid: 11000, status: "paid", issueDate: "2026-05-15", dueDate: "2026-05-30", paidDate: "2026-06-02", paymentMethod: "Stripe", owner: "Daniel Osei", lastReminder: null, stripeStatus: "Paid", lineItems: [{ description: "Initial Deposit", amount: 11000 }] },
  { id: "inv-p2", number: "INV-2026-011", client: "Verdant Farms", project: "Marketing Website", amount: 9800, amountPaid: 9800, status: "paid", issueDate: "2026-05-10", dueDate: "2026-05-24", paidDate: "2026-06-01", paymentMethod: "Bank Transfer", owner: "Aiko Tanaka", lastReminder: null, stripeStatus: "Paid", lineItems: [{ description: "Final Payment", amount: 9800 }] },
  { id: "inv-p3", number: "INV-2026-010", client: "Umbrella Group", project: "Enterprise License", amount: 21000, amountPaid: 21000, status: "paid", issueDate: "2026-05-04", dueDate: "2026-05-18", paidDate: "2026-05-21", paymentMethod: "Stripe", owner: "Elena Brooks", lastReminder: null, stripeStatus: "Paid", lineItems: [{ description: "Enterprise License", amount: 21000 }] },
  { id: "inv-p4", number: "INV-2026-009", client: "Cobalt Media", project: "Content Migration", amount: 6200, amountPaid: 6200, status: "paid", issueDate: "2026-04-28", dueDate: "2026-05-12", paidDate: "2026-05-19", paymentMethod: "Card", owner: "Aiko Tanaka", lastReminder: null, stripeStatus: "Paid", lineItems: [{ description: "Content Migration", amount: 6200 }] },
  { id: "inv-p5", number: "INV-2026-008", client: "Northwind Studio", project: "Design System Audit", amount: 4500, amountPaid: 4500, status: "paid", issueDate: "2026-04-20", dueDate: "2026-05-04", paidDate: "2026-05-09", paymentMethod: "Stripe", owner: "Elena Brooks", lastReminder: null, stripeStatus: "Paid", lineItems: [{ description: "Design System Audit", amount: 4500 }] }
];

export const financeData = {
  monthly: [
    { month: "Jan", income: 39000, expenses: 22000, net: 17000 },
    { month: "Feb", income: 43000, expenses: 23500, net: 19500 },
    { month: "Mar", income: 47500, expenses: 25000, net: 22500 },
    { month: "Apr", income: 44000, expenses: 24000, net: 20000 },
    { month: "May", income: 51000, expenses: 27000, net: 24000 },
    { month: "Jun", income: 56000, expenses: 29500, net: 26500 },
    { month: "Jul", income: 34000, expenses: 19000, net: 15000 },
    { month: "Aug", income: 38500, expenses: 21000, net: 17500 },
    { month: "Sep", income: 32000, expenses: 18500, net: 13500 },
    { month: "Oct", income: 41000, expenses: 23000, net: 18000 },
    { month: "Nov", income: 45500, expenses: 24500, net: 21000 },
    { month: "Dec", income: 52000, expenses: 28000, net: 24000 }
  ],
  categories: [
    { name: "Payroll", value: 45, color: "#c4b5fd" },
    { name: "Contractors", value: 25, color: "#a5f3fc" },
    { name: "Software", value: 15, color: "#fca5a5" },
    { name: "Marketing", value: 10, color: "#fde68a" },
    { name: "Office", value: 5, color: "#bbf7d0" }
  ],
  transactions: [
    { id: "tx1", date: "2026-06-15", description: "Vercel Hosting", amount: -120, category: "Software" },
    { id: "tx2", date: "2026-06-14", description: "Stripe Payout - Atlas Fintech", amount: 12500, category: "Income" },
    { id: "tx3", date: "2026-06-12", description: "Aiko Tanaka (Contractor)", amount: -4200, category: "Contractors" },
    { id: "tx4", date: "2026-06-10", description: "AWS Web Services", amount: -850, category: "Software" },
    { id: "tx5", date: "2026-06-08", description: "Stripe Payout - Pulse Robotics", amount: 9200, category: "Income" },
    { id: "tx6", date: "2026-06-05", description: "WeWork Office Space", amount: -2100, category: "Office" }
  ]
};
