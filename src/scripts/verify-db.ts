import { prisma } from "../lib/prisma";

async function main() {
  const profile = await prisma.userProfile.findFirst();
  console.log("UserProfile row:", profile);
  const counts = {
    experience: await prisma.experienceDetails.count(),
    education: await prisma.educationDetails.count(),
    certifications: await prisma.certificationDetails.count(),
    skills: await prisma.skill.count(),
    tools: await prisma.tool.count(),
    projects: await prisma.projectDetails.count(),
    blogPosts: await prisma.blogPost.count(),
    contactMessages: await prisma.contactMessage.count(),
    adminUsers: await prisma.adminUser.count(),
  };
  console.log("Row counts:", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
