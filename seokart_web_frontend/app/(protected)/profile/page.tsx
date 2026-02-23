"use client";

import Link from "next/link";
import React, { useState, useCallback } from "react";
import Image from "next/image";
import { showToast } from "@/lib/toast";
import TechnicalTable from "./TechnicalTable";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { startSitemapCrawl } from "@/store/slices/scraperSlice";
import { Loader2 } from "lucide-react";

export default function Technical() {
  const [websiteUrl, setWebsiteUrl] = useState("");
  
  const dispatch = useAppDispatch();
  const { loading } = useAppSelector((state) => state.scraper);
  const { userPlan } = useAppSelector((state) => state.userPlan);

  const handleStartCrawl = useCallback(async () => {
    if (!websiteUrl.trim()) {
      showToast("Please enter a website URL", "error");
      return;
    }
    // if(userPlan && userPlan.webCrawler.plan === "free") {
    //   showToast("You are on the free plan. Please upgrade to a paid plan to start crawling", "error");
    //   return;
    // }

    try {
      showToast("Starting crawl...", "info");
      
      const payload: any = { websiteUrl: websiteUrl.trim() };

      await dispatch(startSitemapCrawl(payload)).unwrap();
      
      showToast("Crawl started successfully", "success");
      setWebsiteUrl("");
    } catch (err: any) {
      console.error("Failed to start crawl:", err);
      showToast(err || "Failed to start crawl. Please try again.", "error");
    }
  }, [websiteUrl, dispatch]);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !loading && websiteUrl.trim()) {
        handleStartCrawl();
      }
    },
    [handleStartCrawl, loading, websiteUrl]
  );

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="page-head flex justify-between mb-6">
        <div className="page-headLeft">
          <h1 className="text-2xl font-semibold text-gray-900">Technical</h1>
        </div>

        <div className="page-headRight flex gap-4">
          <Link
            href="/"
            className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <Image
              src="/images/logout-icon.svg"
              alt=""
              width="20"
              height="20"
            />
          </Link>
        </div>
      </div>

      <div className="card bg-white rounded-xl px-4 py-4 mb-6">
        <div className="flex flex-col gap-4">
          <div className="flex gap-4">
            <div className="w-full">
              <div className="relative">
                <input
                  className="h-[38px] peer w-full bg-transparent placeholder:text-[#9b9b9b] placeholder:text-sm text-black text-xs border border-[#dee2e6] rounded-md px-3 py-3 transition duration-300 ease focus:outline-none focus:border-slate-400 hover:border-slate-300"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  onKeyPress={handleKeyPress}
                  type="url"
                  placeholder="Enter website URL (e.g., https://example.com)"
                  disabled={loading}
                />
              </div>
            </div>

            <button
              className="custom-btn w-[188px] rounded-lg py-2 px-4 border border-transparent text-center text-[13px] font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
              onClick={handleStartCrawl}
              disabled={loading || !websiteUrl.trim()}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Starting...
                </span>
              ) : (
                "Start Crawl"
              )}
            </button>
          </div>

        </div>
      </div>

      <TechnicalTable />
    </div>
  );
}