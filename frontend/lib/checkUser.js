import { auth, currentUser } from "@clerk/nextjs/server";

const STRAPI_URL = process.env.STRAPI_API_URL || "http://localhost:1337";
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

export const checkUser = async () => {
  const user = await currentUser();

  if (!user) {
    console.log("No User found");
    return null;
  }

  if (!STRAPI_API_TOKEN) {
    console.error("❌ STRAPI_API_TOKEN is missing in environment variables");
    return null;
  }

  // Check if user has Pro plan
  const { has } = await auth();
  const subscriptionTier = has({ plan: "pro" }) ? "pro" : "free";

  try {
    // 1. Fetch User securely with explicit array parsing
    const existingUserResponse = await fetch(
      `${STRAPI_URL}/api/users?filters[clerkId][$eq]=${user.id}`,
      {
        headers: {
          "Authorization": `Bearer ${STRAPI_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        cache: "no-store",
      }
    );

    if (!existingUserResponse.ok) {
      const errorText = await existingUserResponse.text();
      console.error("Strapi error response:", errorText);
      return null;
    }

    const existingUserData = await existingUserResponse.json();

    // ✅ FIXED: Accurately read item from the array matrix
    if (Array.isArray(existingUserData) && existingUserData.length > 0) {
      const existingUser = existingUserData[0];

      // Update subscription tier if changed
      if (existingUser.subscriptionTier !== subscriptionTier) {
        await fetch(`${STRAPI_URL}/api/users/${existingUser.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${STRAPI_API_TOKEN}`,
          },
          body: JSON.stringify({ subscriptionTier }),
          cache: "no-store",
        });
      }

      return { ...existingUser, subscriptionTier };
    }

    // 2. Fetch authenticated roles layout safely
    const rolesResponse = await fetch(
      `${STRAPI_URL}/api/users-permissions/roles`,
      {
        headers: {
          "Authorization": `Bearer ${STRAPI_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        cache: "no-store",
      }
    );

    if (!rolesResponse.ok) {
      console.error("❌ Failed to fetch Strapi roles context setup");
      return null;
    }

    const rolesData = await rolesResponse.json();
    const authenticatedRole = rolesData?.roles?.find(
      (role) => role.type === "authenticated"
    );

    if (!authenticatedRole) {
      console.error("❌ Authenticated role not found");
      return null;
    }

    // 3. Create a brand new user profile 
    const fallbackUsername = user.emailAddresses?.[0]?.emailAddress?.split("@")[0] || `user_${Date.now()}`;
    const userEmail = user.emailAddresses?.[0]?.emailAddress || "";

    const userData = {
      username: user.username || fallbackUsername,
      email: userEmail,
      password: `clerk_managed_${user.id}_${Date.now()}`,
      confirmed: true,
      blocked: false,
      role: authenticatedRole.id,
      clerkId: user.id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      imageUrl: user.imageUrl || "",
      subscriptionTier,
    };

    const newUserResponse = await fetch(`${STRAPI_URL}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${STRAPI_API_TOKEN}`,
      },
      body: JSON.stringify(userData),
      cache: "no-store",
    });

    if (!newUserResponse.ok) {
      const errorText = await newUserResponse.text();
      console.error("❌ Error creating user:", errorText);
      return null;
    }

    const newUser = await newUserResponse.json();
    return newUser;
  } catch (error) {
    console.error("❌ Error inside checkUser wrapper execution:", error.message);
    return null;
  }
};
