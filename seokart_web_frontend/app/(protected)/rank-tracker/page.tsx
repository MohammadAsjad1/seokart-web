"use client";

import React, { useCallback, useEffect ,useMemo} from "react";
import Image from "next/image";
import Link from "next/link";
import RankTrackerTable from "./RankTrackerTable";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { refreshUserPlan } from "@/store/slices/userPlanSlice";
import { setSelectedChannel } from "@/store/slices/channelSlice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SquareArrowOutUpRight } from "lucide-react";

export default function RankTracker() {

  const dispatch = useAppDispatch();
    const {
    userPlan
  } = useAppSelector((state) => state.userPlan);

  const { channels,selectedChannel } = useAppSelector((state) => state.channel);

  const handleChannelChange = useCallback((value: string) => {
    const channel = channels?.find((channel) => channel.storefront_url === value);
    if (channel) {
      dispatch(setSelectedChannel(channel));
    }
  }, [channels, dispatch]);

   const activeDomain = useMemo(
    () => userPlan?.activeDomain || userPlan?.activeDomainDetails?.domain,
    [userPlan?.activeDomain, userPlan?.activeDomainDetails?.domain]
  );

  useEffect(()=>{
    dispatch(refreshUserPlan());

  },[dispatch])

  return (
      <section className="p-6 bg-gray-50 min-h-screen">
        <div>
          <div className="page-head flex justify-between mb-6">
            <div className="page-headLeft flex gap-4">
              <h1 className="text-black text-xl font-semibold leading-tight">
                Keywords/Competitors
              </h1>
              <div className="w-[250px] relative">
                <Select defaultValue={selectedChannel?.storefront_url} onValueChange={handleChannelChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {
                        channels && channels?.length > 0 && channels?.map((channel) => (
                          <SelectItem key={channel.channel_id} value={channel.storefront_url}>
                            {channel.storefront_url}
                          </SelectItem>
                        ))
                      }
                    </SelectContent>
                </Select>
                <div 
                  className="flex items-center gap-1 absolute -top-2 left-3 p-y-0.5 px-1 bg-white rounded">
                    <span className="text-xs font-medium text-gray-600">Channel</span>
                    <Link href={`${selectedChannel?.storefront_url}`} target="_blank" className="hover:text-gray-700">
                      <SquareArrowOutUpRight className="w-3 h-3" />
                    </Link>
                </div>
              </div>
              {/* {userPlan && (
                <div className="flex items-center gap-4 mt-2">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>Keywords:</span>
                    <span className="font-medium">
                      {userPlan.rankTracker.usage.keywordsUsed} / {userPlan.rankTracker.limits.keywords === -1 ? '∞' : userPlan.rankTracker.limits.keywords}
                    </span>
                    {keywordLimitReached && (
                      <span className="text-red-500 text-xs">(Limit reached)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>Competitors:</span>
                    <span className="font-medium">
                      {userPlan.rankTracker.usage.competitorsUsed} / {userPlan.rankTracker.limits.competitors === -1 ? '∞' : userPlan.rankTracker.limits.competitors}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>Plan:</span>
                    <span className="font-medium capitalize text-blue-600">
                      {userPlan.rankTracker.plan}
                    </span>
                  </div>
                </div>
              )} */}
            </div>

            <div className="page-headRight flex gap-4 h-10">
              <Link
                href="/rank-tracker/add-keyword"
                className={`custom-btn rounded-lg py-2 px-4 border border-transparent text-center text-[13px] font-semibold text-white transition-all`}
              >
                Add Keyword
              </Link>

              {/* <Link
                href="/"
                className="bg-gray-50 border border-slate-200 w-[46px] h-[38px] flex rounded-lg justify-center items-center hover:bg-gray-100 transition-colors"
              >
                <Image
                  src="/images/logout-icon.svg"
                  alt="Logout"
                  width="20"
                  height="20"
                />
              </Link> */}

              <button
                className="bg-white border border-slate-200 w-[46px] h-[38px] flex rounded-lg justify-center items-center hover:bg-gray-50 transition-colors"
                title="Plan settings"
              >
                <Image
                  src="/images/hamburger-menu.svg"
                  alt="Menu"
                  width="16"
                  height="14"
                />
              </button>
            </div>
          </div>


          <div className="card bg-white rounded-xl px-4 py-4">
            <RankTrackerTable domain={activeDomain || ""} />
          </div>
        </div>
      </section>
  );
}
