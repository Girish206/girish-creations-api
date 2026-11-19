// The general (shared) expense categories everyone picks from: broad,
// not tied to one country's bills. `icon` is a Font Awesome class; `from`
// lists the older, detailed categories each one replaced (used by
// generalise-categories.ts to fold them in).
export const GENERAL_CATEGORIES: { name: string; icon: string; from: string[] }[] = [
  { name: "Food & Dining", icon: "fa-utensils", from: ["Dining Out", "Food Delivery", "Snacks & Beverages"] },
  { name: "Groceries", icon: "fa-basket-shopping", from: ["Vegetables & Fruits", "Milk & Dairy"] },
  { name: "Housing", icon: "fa-house", from: ["Rent", "Maintenance & Society", "Home Repairs"] },
  { name: "Household", icon: "fa-couch", from: ["Household Supplies", "Furniture & Appliances", "Domestic Help"] },
  {
    name: "Bills & Utilities",
    icon: "fa-bolt",
    from: ["Electricity", "Water", "Gas / LPG", "Mobile Recharge", "Internet & Broadband", "DTH / Cable TV"],
  },
  { name: "Subscriptions", icon: "fa-tv", from: ["Subscriptions (OTT, Apps)", "Software & Tools"] },
  {
    name: "Transport",
    icon: "fa-car",
    from: ["Fuel", "Public Transport", "Cab & Auto", "Parking & Tolls", "Vehicle Maintenance"],
  },
  { name: "Health & Fitness", icon: "fa-heart-pulse", from: ["Medicines", "Doctor & Hospital", "Fitness & Gym"] },
  { name: "Shopping", icon: "fa-bag-shopping", from: ["Clothing & Footwear", "Electronics & Gadgets"] },
  { name: "Personal Care", icon: "fa-spa", from: ["Personal Care & Salon"] },
  { name: "Education", icon: "fa-graduation-cap", from: ["Education & School Fees", "Books & Courses"] },
  { name: "Family & Kids", icon: "fa-baby", from: ["Childcare", "Family Support"] },
  { name: "Pets", icon: "fa-paw", from: [] },
  { name: "Entertainment", icon: "fa-film", from: ["Entertainment & Movies"] },
  { name: "Travel", icon: "fa-suitcase-rolling", from: ["Travel & Vacation", "Hotels & Stays"] },
  { name: "Gifts & Donations", icon: "fa-gift", from: ["Gifts", "Festivals & Celebrations", "Donations & Charity"] },
  { name: "Insurance", icon: "fa-shield-heart", from: ["Health Insurance", "Life Insurance", "Vehicle Insurance"] },
  {
    name: "Loans & EMIs",
    icon: "fa-credit-card",
    from: ["Home Loan EMI", "Vehicle Loan EMI", "Loan EMI (Personal)", "Credit Card Bill"],
  },
  { name: "Taxes & Fees", icon: "fa-file-invoice-dollar", from: ["Taxes", "Bank Charges & Fees"] },
  { name: "Work", icon: "fa-briefcase", from: ["Office & Work Expenses"] },
  { name: "Other", icon: "fa-tags", from: ["Miscellaneous"] },
];
