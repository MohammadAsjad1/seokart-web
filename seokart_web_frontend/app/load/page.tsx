"use client";

import { useAppDispatch } from "@/store/hooks";
// import { setChannels, setSelectedChannel } from "@/store/slices/channelSlice";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { loadUser } from "@/store/slices/authSlice";

function LoadPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [error, setError] = useState("");

  useEffect(() => {
    const verifyAndRedirect = async () => {
      const signedPayload = searchParams.get("signed_payload_jwt");
      if (!signedPayload) {
        setError("Missing signed payload");
        return;
      }
      const result = await dispatch(loadUser(signedPayload)).unwrap();
      if (result.user) {
        const { user, token, sessionExpiresAt } = result;
        // console.log("user data --------------", user);
        localStorage.setItem("storeHash", user.store_hash);
        localStorage.setItem("userId", user._id);
        localStorage.setItem("userEmail", user.email);
        localStorage.setItem("sessionExpiresAt", sessionExpiresAt);
        localStorage.setItem("storeId", user.store_id);
        localStorage.setItem("token", token);
        router.replace(user.needsSetup ? `/select-plan` : `/dashboard`);
      } else {
        setError(result.message || "Failed to load user");
      }
    };
    verifyAndRedirect();
  }, [searchParams]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Error</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
        <p>Loading your app...</p>
      </div>
    </div>
  );
}

export default function LoadPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
            <p>Loading...</p>
          </div>
        </div>
      }
    >
      <LoadPageContent />
    </Suspense>
  );
}
