import { prisma } from "../src/lib/prisma";

// A broad starter set of expense categories for an Indian household/personal
// budget. Safe to re-run: names that already exist (compared case-
// insensitively) are skipped, so categories added or renamed by hand stay.
//   npm run seed:categories
const CATEGORIES = [
  // Food
  "Groceries",
  "Vegetables & Fruits",
  "Milk & Dairy",
  "Dining Out",
  "Food Delivery",
  "Snacks & Beverages",
  // Home
  "Rent",
  "Home Loan EMI",
  "Maintenance & Society",
  "Household Supplies",
  "Home Repairs",
  "Furniture & Appliances",
  "Domestic Help",
  // Utilities & bills
  "Electricity",
  "Water",
  "Gas / LPG",
  "Mobile Recharge",
  "Internet & Broadband",
  "DTH / Cable TV",
  "Subscriptions (OTT, Apps)",
  // Transport
  "Fuel",
  "Public Transport",
  "Cab & Auto",
  "Vehicle Maintenance",
  "Vehicle Insurance",
  "Parking & Tolls",
  "Vehicle Loan EMI",
  // Health
  "Medicines",
  "Doctor & Hospital",
  "Health Insurance",
  "Fitness & Gym",
  // Personal
  "Clothing & Footwear",
  "Personal Care & Salon",
  "Electronics & Gadgets",
  "Shopping",
  // Family & education
  "Education & School Fees",
  "Books & Courses",
  "Childcare",
  "Pets",
  // Social & leisure
  "Entertainment & Movies",
  "Travel & Vacation",
  "Hotels & Stays",
  "Gifts",
  "Festivals & Celebrations",
  "Donations & Charity",
  "Family Support",
  // Money
  "Loan EMI (Personal)",
  "Credit Card Bill",
  "Life Insurance",
  "Taxes",
  "Bank Charges & Fees",
  // Work
  "Office & Work Expenses",
  "Software & Tools",
  // Catch-all
  "Miscellaneous",
];

async function main() {
  const existing = await prisma.expenseCategory.findMany({ select: { name: true } });
  const taken = new Set(existing.map((c) => c.name.trim().toLowerCase()));
  const toAdd = CATEGORIES.filter((name) => !taken.has(name.toLowerCase()));

  if (toAdd.length > 0) {
    await prisma.expenseCategory.createMany({ data: toAdd.map((name) => ({ name })) });
  }
  console.log(`Added ${toAdd.length} categories; ${CATEGORIES.length - toAdd.length} already existed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
