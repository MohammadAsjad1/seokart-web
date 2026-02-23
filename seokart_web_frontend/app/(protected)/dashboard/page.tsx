"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { ExternalLink, SlidersHorizontal, X, RefreshCw } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getDashboardData,
  checkProcessingStatus,
  refreshBacklinkData,
  setSearchTerm,
  setSortBy,
  setFirstSeenFromDate,
  setFirstSeenToDate,
  setLastSeenFromDate,
  setLastSeenToDate,
  setCurrentPage,
  setMinDomainScore,
  setMaxDomainScore,
  setLinkTypes,
  setAnchorText,
  clearError,
} from "@/store/slices/backlinkSlice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import { Button } from "@/components/ui/Button";
import DropdownCustom from "../../components/dropdown";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import DualRangeSlider from "@/components/ui/DualRangeSlider";
import { selectUserPlan ,selectUserPlanLoading} from "@/store/selectors/userPlanSelectors";
import { refreshUserPlan } from '@/store/slices/userPlanSlice';

const LoadingSpinner = ({ size = "w-6 h-6", className = "" }) => (
  <div className={`${className} flex items-center justify-center`}>
    <RefreshCw className={`${size} animate-spin text-gray-400`} />
  </div>
);

const CircularSkeleton = () => (
  <div className="flex items-center">
    <div className="w-[70px] h-[70px] bg-gray-200 rounded-full animate-pulse flex items-center justify-center">
      <div className="w-8 h-8 bg-gray-300 rounded-full"></div>
    </div>
    <div className="ml-4">
      <div className="w-12 h-8 bg-gray-200 rounded animate-pulse"></div>
    </div>
  </div>
);

const StatCardSkeleton = ({ title="", hasProgress = false }) => (
  <div className="card bg-white rounded-xl px-4 py-4">
    <h3 className="text-lg font-semibold text-black mb-4">{title}</h3>
    <div className={`${hasProgress ? "mb-4" : ""}`}>
      {hasProgress && (
        <div className="h-4 bg-gray-200 rounded animate-pulse mb-4"></div>
      )}
      <div className="grid grid-cols-2 gap-6 items-center">
        <div className="flex flex-col gap-1.5 border border-zinc-100 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse"></div>
            <div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div>
          </div>
          <div className="w-16 h-6 bg-gray-200 rounded animate-pulse"></div>
        </div>
        <div className="flex flex-col gap-1.5 border border-zinc-100 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-pulse"></div>
            <div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div>
          </div>
          <div className="w-16 h-6 bg-gray-200 rounded animate-pulse"></div>
        </div>
      </div>
    </div>
  </div>
);

const TableSkeleton = () => (
  <>
    {[...Array(5)].map((_, index) => (
      <TableRow key={index}>
        <TableCell className="px-4">
          <div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div>
        </TableCell>
        <TableCell className="px-4">
          <div className="w-16 h-4 bg-gray-200 rounded animate-pulse"></div>
        </TableCell>
        <TableCell className="px-4">
          <div className="w-32 h-4 bg-gray-200 rounded animate-pulse"></div>
        </TableCell>
        <TableCell className="px-4">
          <div className="w-16 h-4 bg-gray-200 rounded animate-pulse"></div>
        </TableCell>
        <TableCell className="px-4">
          <div className="w-28 h-4 bg-gray-200 rounded animate-pulse"></div>
        </TableCell>
        <TableCell className="px-4">
          <div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div>
        </TableCell>
        <TableCell className="px-4">
          <div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div>
        </TableCell>
        <TableCell className="px-4">
          <div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div>
        </TableCell>
      </TableRow>
    ))}
  </>
);

const getPathColor = (value: number): string => {
  if (value >= 0 && value < 70) return "#FC7B7B";
  else if (value >= 70 && value < 80) return "#FBC78C";
  else if (value >= 80 && value <= 100) return "#91C561";
  return "#FC7B7B";
};

const formatDate = (dateString: string) => {
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "N/A";
  }
};

const formatNumber = (num: number) => {
  if (!num && num !== 0) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  else if (num >= 1000) return (num / 1000).toFixed(1) + "k";
  return num.toString();
};

const extractDomain = (url: string) => {
  try {
    const domain = new URL(url.startsWith("http") ? url : `https://${url}`)
      .hostname;
    return domain.replace("www.", "");
  } catch {
    return url || "";
  }
};

const BacklinkDashboard = () => {
  const dispatch = useAppDispatch();
  const userPlan = useAppSelector(selectUserPlan);
  const userPlanLoading = useAppSelector(selectUserPlanLoading);

  const {
    dashboardData,
    backlinkSummary,
    backlinksData,
    loading,
    processing,
    error,
    searchTerm,
    sortBy,
    firstSeenFromDate,
    firstSeenToDate,
    lastSeenFromDate,
    lastSeenToDate,
    currentPage,
    itemsPerPage,
    minDomainScore,
    maxDomainScore,
    linkTypes,
    anchorText,
  } = useAppSelector((state) => state.backlink);

  const statusCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const hasInitialized = useRef(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastFiltersRef = useRef({
    searchTerm,
    sortBy,
    firstSeenFromDate,
    firstSeenToDate,
    lastSeenFromDate,
    lastSeenToDate,
    currentPage,
    minDomainScore,
    maxDomainScore,
    linkTypes,
    anchorText,
  });
  const [showFilters, setShowFilters] = React.useState(false);

  const getWebsiteUrl = useCallback((): string | null => {
    if (!userPlan?.userPlan?.activeDomain) return null;
    return userPlan.userPlan.activeDomain;
  }, [userPlan]);

  const triggerDataLoad = useCallback(
    (websiteUrl: string, resetPage = false) => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      searchTimeoutRef.current = setTimeout(() => {
        const options = {
          page: resetPage ? 1 : currentPage,
          limit: itemsPerPage,
          query: searchTerm || "",
          firstSeenFromDate: firstSeenFromDate || "",
          firstSeenToDate: firstSeenToDate || "",
          lastSeenFromDate: lastSeenFromDate || "",
          lastSeenToDate: lastSeenToDate || "",
          sortBy: sortBy || "lastFetched",
          minDomainScore,
          maxDomainScore,
          linkTypes,
          anchorText: anchorText || "",
        };

        if (resetPage) dispatch(setCurrentPage(1));
        dispatch(getDashboardData({ websiteUrl, options }));
      }, 300);
    },
    [
      currentPage,
      itemsPerPage,
      searchTerm,
      firstSeenFromDate,
      firstSeenToDate,
      lastSeenFromDate,
      lastSeenToDate,
      sortBy,
      minDomainScore,
      maxDomainScore,
      linkTypes,
      anchorText,
      dispatch,
    ]
  );

  useEffect(() => {
    dispatch(refreshUserPlan());
  }, [dispatch]);


  useEffect(() => {
  const websiteUrl = getWebsiteUrl();

  
  if (!websiteUrl || !userPlan) {
    return;
  }

  if (!hasInitialized.current) {
    const options = {
      page: 1,
      limit: itemsPerPage,
      query: "",
      sortBy: "inlink_rank",
      minDomainScore: 0,
      maxDomainScore: 100,
    };
    dispatch(setCurrentPage(1));
    dispatch(getDashboardData({ websiteUrl, options }));
    hasInitialized.current = true;
  }
}, [userPlan, dispatch, itemsPerPage,getWebsiteUrl]);


  useEffect(() => {
    const websiteUrl = getWebsiteUrl();
    const currentFilters = {
      searchTerm,
      sortBy,
      firstSeenFromDate,
      firstSeenToDate,
      lastSeenFromDate,
      lastSeenToDate,
      currentPage,
      minDomainScore,
      maxDomainScore,
      linkTypes,
      anchorText,
    };
    const lastFilters = lastFiltersRef.current;

    if (websiteUrl && hasInitialized.current && !loading) {
      const filtersChanged =
        lastFilters.searchTerm !== currentFilters.searchTerm ||
        lastFilters.sortBy !== currentFilters.sortBy ||
        lastFilters.firstSeenFromDate !== currentFilters.firstSeenFromDate ||
        lastFilters.firstSeenToDate !== currentFilters.firstSeenToDate ||
        lastFilters.lastSeenFromDate !== currentFilters.lastSeenFromDate ||
        lastFilters.lastSeenToDate !== currentFilters.lastSeenToDate ||
        lastFilters.minDomainScore !== currentFilters.minDomainScore ||
        lastFilters.maxDomainScore !== currentFilters.maxDomainScore ||
        JSON.stringify(lastFilters.linkTypes) !==
          JSON.stringify(currentFilters.linkTypes) ||
        lastFilters.anchorText !== currentFilters.anchorText;

      const pageChanged =
        lastFilters.currentPage !== currentFilters.currentPage;

      if (filtersChanged || pageChanged) {
        lastFiltersRef.current = currentFilters;
        const resetPage = filtersChanged && !pageChanged;
        triggerDataLoad(websiteUrl, resetPage);
      }
    }

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [
    searchTerm,
    sortBy,
    firstSeenFromDate,
    firstSeenToDate,
    lastSeenFromDate,
    lastSeenToDate,
    currentPage,
    minDomainScore,
    maxDomainScore,
    linkTypes,
    anchorText,
    loading,
    triggerDataLoad,
  ]);

  useEffect(() => {
    const websiteUrl = getWebsiteUrl();

    if (processing && websiteUrl) {
      if (statusCheckInterval.current)
        clearInterval(statusCheckInterval.current);

      statusCheckInterval.current = setInterval(async () => {
        const result = await dispatch(checkProcessingStatus(websiteUrl));

        if (result.payload && result.payload.success && result.payload.data) {
          if (result.payload.data.status !== "processing") {
            if (statusCheckInterval.current) {
              clearInterval(statusCheckInterval.current);
              statusCheckInterval.current = null;
            }

            if (result.payload.data.status === "completed") {
              const options = {
                page: 1,
                limit: itemsPerPage,
                query: searchTerm || "",
                sortBy: sortBy || "inlink_rank",
                minDomainScore,
                maxDomainScore,
              };
              dispatch(getDashboardData({ websiteUrl, options }));
            }
          }
        }
      }, 10000);
    }

    return () => {
      if (statusCheckInterval.current) {
        clearInterval(statusCheckInterval.current);
        statusCheckInterval.current = null;
      }
    };
  }, [
    processing,
    dispatch,
    itemsPerPage,
    searchTerm,
    sortBy,
    minDomainScore,
    maxDomainScore,
    userPlan,
  ]);

  const dropdownPageFilter = [
    { value: "lastFetched", label: "Latest" },
    { value: "websiteUrl", label: "Domain - A to Z" },
    { value: "websiteUrl_desc", label: "Domain - Z to A" },
    { value: "inlink_rank", label: "Page Score - High to Low" },
    { value: "inlink_rank_asc", label: "Page Score - Low to High" },
    { value: "domain_inlink_rank", label: "Domain Score - High to Low" },
    { value: "domain_inlink_rank_asc", label: "Domain Score - Low to High" },
  ];

  const handleRefresh = async () => {
    const websiteUrl = getWebsiteUrl();
    if (websiteUrl) {
      dispatch(clearError());
      await dispatch(refreshBacklinkData(websiteUrl));
      const options = {
        page: 1,
        limit: itemsPerPage,
        query: searchTerm || "",
        sortBy: sortBy || "inlink_rank",
        minDomainScore,
        maxDomainScore,
      };
      dispatch(getDashboardData({ websiteUrl, options }));
    }
  };

  const handlePageChange = (page: number) => {
    dispatch(setCurrentPage(page));
  };

  const toggleLinkType = (type: string) => {
    const newLinkTypes = linkTypes.includes(type)
      ? linkTypes.filter((t) => t !== type)
      : [...linkTypes, type];
    dispatch(setLinkTypes(newLinkTypes));
  };

  const clearAllFilters = () => {
    dispatch(setSearchTerm(""));
    dispatch(setAnchorText(""));
    dispatch(setFirstSeenFromDate(""));
    dispatch(setFirstSeenToDate(""));
    dispatch(setLastSeenFromDate(""));
    dispatch(setLastSeenToDate(""));
    dispatch(setMinDomainScore(0));
    dispatch(setMaxDomainScore(100));
    dispatch(setLinkTypes([]));
  };

  const activeFiltersCount = [
    searchTerm,
    anchorText,
    firstSeenFromDate,
    firstSeenToDate,
    lastSeenFromDate,
    lastSeenToDate,
    minDomainScore !== 0 || maxDomainScore !== 100,
    linkTypes.length > 0,
  ].filter(Boolean).length;

  const isInitialLoading =
    loading && !backlinkSummary && !backlinksData?.length;
  const hasData = backlinkSummary || backlinksData?.length > 0;

  const currentDocument = backlinkSummary || dashboardData?.documents?.[0];
  const currentBacklinks =
    backlinksData || currentDocument?.backlinks_data || [];
  const pagination = dashboardData?.pagination;

  const domainScore = currentDocument?.domain_inlink_rank || 0;
  const pageScore = currentDocument?.inlink_rank || 0;
  const totalBacklinks = currentDocument?.backlinks || 0;
  const totalRefdomains = currentDocument?.refdomains || 0;
  const dofollowBacklinks = currentDocument?.dofollow_backlinks || 0;
  const nofollowBacklinks = currentDocument?.nofollow_backlinks || 0;
  const dofollowPercentage =
    totalBacklinks > 0
      ? Math.round((dofollowBacklinks / totalBacklinks) * 100)
      : 0;

  if (!userPlan || userPlanLoading) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-semibold text-gray-900">Backlink</h1>
            <div className="flex gap-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <LoadingSpinner size="w-4 h-4" />
                <span className="text-sm text-blue-700">Loading...</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[30px] mb-6">
            <div className="card bg-white rounded-xl px-4 py-4">
              <div className="flex justify-between gap-6">
                <div className="flex flex-col">
                  <h3 className="text-lg font-semibold text-black mb-4">
                    Domain Score
                  </h3>
                  <CircularSkeleton />
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-semibold text-black mb-4">
                    Page Score
                  </h3>
                  <CircularSkeleton />
                </div>
              </div>
            </div>

            <StatCardSkeleton title="Total Backlinks / Referring Domains" />
            <StatCardSkeleton title="Dofollow / Nofollow" hasProgress />
          </div>

          <div className="card bg-white rounded-xl px-4 py-4">
            <div className="tab-headRight flex justify-between gap-4 mb-[30px]">
              <div className="w-80 h-[38px] bg-gray-200 rounded animate-pulse"></div>
              <div className="w-[200px] h-[38px] bg-gray-200 rounded animate-pulse"></div>
            </div>

            <div className="border-table border border-[#dee2e6] rounded-xl">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="bg-[#F7F7F7] rounded-tl-xl text-black font-semibold text-[13px] px-4">
                      Domain
                    </TableHead>
                    <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                      Domain Score
                    </TableHead>
                    <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                      Page URL
                    </TableHead>
                    <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                      Page Score
                    </TableHead>
                    <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                      Anchor Text / Target URL
                    </TableHead>
                    <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                      Link Type
                    </TableHead>
                    <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                      First Seen
                    </TableHead>
                    <TableHead className="bg-[#F7F7F7] rounded-tr-xl text-black font-semibold text-[13px] px-4 w-[100px]">
                      Last Seen
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableSkeleton />
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Backlink</h1>
          <div className="flex gap-2">
            <button className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center justify-between">
              <p className="text-red-700">{error}</p>
              <button
                onClick={() => dispatch(clearError())}
                className="text-red-500 hover:text-red-700"
              >
                ×
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[30px] mb-6">
          <div className="card bg-white rounded-xl px-4 py-4">
            <div className="flex justify-between gap-6">
              <div className="flex flex-col">
                <h3 className="text-lg font-semibold text-black mb-4">
                  Domain Score
                </h3>
                <div className="flex items-center">
                  {loading ? (
                    <CircularSkeleton />
                  ) : (
                    <>
                      <div style={{ width: 70, height: 70 }}>
                        <CircularProgressbar
                          value={domainScore}
                          text={domainScore.toString()}
                          strokeWidth={16}
                          styles={buildStyles({
                            textColor: getPathColor(domainScore),
                            strokeLinecap: "butt",
                            pathColor: getPathColor(domainScore),
                          })}
                        />
                      </div>
                      <div className="ml-4">
                        <div className="text-3xl font-bold text-gray-900">
                          {domainScore}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col">
                <h3 className="text-lg font-semibold text-black mb-4">
                  Page Score
                </h3>
                <div className="flex items-center">
                  {loading ? (
                    <CircularSkeleton />
                  ) : (
                    <>
                      <div style={{ width: 70, height: 70 }}>
                        <CircularProgressbar
                          value={pageScore}
                          text={pageScore.toString()}
                          strokeWidth={16}
                          styles={buildStyles({
                            textColor: getPathColor(pageScore),
                            strokeLinecap: "butt",
                            pathColor: getPathColor(pageScore),
                          })}
                        />
                      </div>
                      <div className="ml-4">
                        <div className="text-3xl font-bold text-gray-900">
                          {pageScore}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="card bg-white rounded-xl px-4 py-4">
            <h3 className="text-lg font-semibold text-black mb-4">
              Total Backlinks / Referring Domains
            </h3>
            <div className="grid grid-cols-2 gap-6 items-center">
              <div className="flex flex-col gap-1.5 border border-zinc-100 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-violet-400 rounded-full"></div>
                  <span className="text-sm text-neutral-500">
                    Total Backlinks
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {loading ? (
                    <div className="w-16 h-6 bg-gray-200 rounded animate-pulse"></div>
                  ) : (
                    <>
                      <span className="text-xl font-bold text-gray-900">
                        {formatNumber(totalBacklinks)}
                      </span>
                      <div className="px-1 py-0.5 bg-[#E0F0E4] rounded inline-flex justify-start items-start gap-2.5">
                        <span className="text-center justify-start text-green-700 text-xs">
                          {processing ? "Processing" : "Fresh"}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 border border-zinc-100 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>
                  <span className="text-xs text-gray-600">
                    Referring Domains
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {loading ? (
                    <div className="w-16 h-6 bg-gray-200 rounded animate-pulse"></div>
                  ) : (
                    <>
                      <span className="text-xl font-bold text-gray-900">
                        {formatNumber(totalRefdomains)}
                      </span>
                      <div className="px-1 py-0.5 bg-[#E0F0E4] rounded inline-flex justify-start items-start gap-2.5">
                        <span className="text-center justify-start text-green-700 text-xs">
                          {processing ? "Processing" : "Fresh"}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="card bg-white rounded-xl px-4 py-4">
            <h3 className="text-lg font-semibold text-black mb-4">
              Dofollow / Nofollow
            </h3>
            <div className="mb-4">
              {loading ? (
                <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
              ) : (
                <Progress
                  value={dofollowPercentage}
                  className="h-4 [&>div]:bg-[#91C561] bg-rose-400"
                />
              )}
            </div>
            <div className="flex justify-between">
              <div>
                {loading ? (
                  <div className="w-12 h-6 bg-gray-200 rounded animate-pulse mb-1"></div>
                ) : (
                  <div className="text-xl font-bold text-gray-900">
                    {formatNumber(dofollowBacklinks)}
                  </div>
                )}
                <div className="text-xs text-neutral-500">Dofollow</div>
              </div>
              <div className="text-right">
                {loading ? (
                  <div className="w-12 h-6 bg-gray-200 rounded animate-pulse mb-1 ml-auto"></div>
                ) : (
                  <div className="text-xl font-bold text-gray-900">
                    {formatNumber(nofollowBacklinks)}
                  </div>
                )}
                <div className="text-xs text-neutral-500">Nofollow</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card bg-white rounded-xl px-4 py-4">
          <div className="tab-headRight flex justify-between gap-4 mb-[30px]">
            <div className="flex gap-4 flex-1">
              <div className="relative flex-1 max-w-80">
                <input
                  id="search_input"
                  className="h-[38px] peer w-full bg-transparent placeholder:text-gray-400 placeholder:text-sm text-black text-xs border border-[#dee2e6] rounded-md px-3 py-3 transition duration-300 ease focus:outline-none focus:border-slate-400 hover:border-slate-300"
                  value={searchTerm}
                  onChange={(e) => dispatch(setSearchTerm(e.target.value))}
                  disabled={loading}
                  placeholder="Search domains, URLs, titles..."
                />
              </div>

              <button
                onClick={() => setShowFilters(!showFilters)}
                className="h-[38px] px-4 flex items-center gap-2 border border-[#dee2e6] rounded-md hover:bg-gray-50 transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span className="text-sm">Filters</span>
                {activeFiltersCount > 0 && (
                  <span className="bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </div>

            <div className="w-[200px]">
              <DropdownCustom
                options={dropdownPageFilter}
                placeholder="Sort by..."
                defaultValue={sortBy}
                onChange={(value: string) => dispatch(setSortBy(value))}
                disabled={loading}
                />
            </div>
          </div>

          {showFilters && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm">Advanced Filters</h3>
                <button
                  onClick={() => {
                    clearAllFilters();
                    setShowFilters(false);
                  }}
                  className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
                >
                  <X className="w-4 h-4" />
                  Clear All
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Anchor Text
                  </label>
                  <input
                    type="text"
                    value={anchorText}
                    onChange={(e) => dispatch(setAnchorText(e.target.value))}
                    placeholder="Search anchor text..."
                    className="w-full h-[38px] px-3 py-2 border border-[#dee2e6] rounded-md text-xs focus:outline-none focus:border-slate-400"
                  />
                </div>

                <div>
                  <DualRangeSlider
                    min={0}
                    max={100}
                    minValue={minDomainScore}
                    maxValue={maxDomainScore}
                    onChange={(min, max) => {
                      dispatch(setMinDomainScore(min));
                      dispatch(setMaxDomainScore(max));
                    }}
                    label="Domain Score Range"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    First Seen Date Range
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">
                        From
                      </label>
                      <input
                        type="date"
                        value={firstSeenFromDate}
                        onChange={(e) =>
                          dispatch(setFirstSeenFromDate(e.target.value))
                        }
                        className="w-full h-[38px] px-3 py-2 border border-[#dee2e6] rounded-md text-xs focus:outline-none focus:border-slate-400"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">
                        To
                      </label>
                      <input
                        type="date"
                        value={firstSeenToDate}
                        onChange={(e) =>
                          dispatch(setFirstSeenToDate(e.target.value))
                        }
                        className="w-full h-[38px] px-3 py-2 border border-[#dee2e6] rounded-md text-xs focus:outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Last Seen Date Range
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">
                        From
                      </label>
                      <input
                        type="date"
                        value={lastSeenFromDate}
                        onChange={(e) =>
                          dispatch(setLastSeenFromDate(e.target.value))
                        }
                        className="w-full h-[38px] px-3 py-2 border border-[#dee2e6] rounded-md text-xs focus:outline-none focus:border-slate-400"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">
                        To
                      </label>
                      <input
                        type="date"
                        value={lastSeenToDate}
                        onChange={(e) =>
                          dispatch(setLastSeenToDate(e.target.value))
                        }
                        className="w-full h-[38px] px-3 py-2 border border-[#dee2e6] rounded-md text-xs focus:outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Link Type
                  </label>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={linkTypes.includes("dofollow")}
                        onChange={() => toggleLinkType("dofollow")}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm">Dofollow</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={linkTypes.includes("nofollow")}
                        onChange={() => toggleLinkType("nofollow")}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm">Nofollow</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="border-table border border-[#dee2e6] rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-[#F7F7F7] rounded-tl-xl text-black font-semibold text-[13px] px-4">
                    Domain
                  </TableHead>
                  <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                    Domain Score
                  </TableHead>
                  <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                    Page URL
                  </TableHead>
                  <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                    Page Score
                  </TableHead>
                  <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                    Anchor Text / Target URL
                  </TableHead>
                  <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                    Link Type
                  </TableHead>
                  <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                    First Seen
                  </TableHead>
                  <TableHead className="bg-[#F7F7F7] rounded-tr-xl text-black font-semibold text-[13px] px-4 w-[100px]">
                    Last Seen
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading || (!hasData && !processing) ? (
                  <TableSkeleton />
                ) : processing && currentBacklinks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-16">
                      <div className="flex flex-col items-center gap-4">
                        <LoadingSpinner size="w-8 h-8" />
                        <div className="text-lg text-gray-600">
                          Processing backlink data...
                        </div>
                        <div className="text-sm text-gray-500">
                          This may take a few minutes
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : currentBacklinks.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center py-8 text-gray-500"
                    >
                      No backlinks found
                    </TableCell>
                  </TableRow>
                ) : (
                  currentBacklinks.map((backlink, index) => (
                    <TableRow key={index} className="hover:bg-transparent">
                      <TableCell className="px-4 text-[13px]">
                        {extractDomain(backlink.url_from)}
                      </TableCell>

                      <TableCell className="px-4 text-[13px]">
                        <div className="flex gap-2 items-center">
                          {backlink.domain_inlink_rank || 0}
                          <Progress
                            value={backlink.domain_inlink_rank || 0}
                            className="w-20 h-[10px] [&>div]:bg-[#7367F0] bg-[#F7F7F7] border border-[#DEE2E6]"
                          />
                        </div>
                      </TableCell>

                      <TableCell className="px-4 text-[13px]">
                        <div className="flex items-center gap-1">
                          <span className="w-40 whitespace-nowrap text-ellipsis overflow-hidden">
                            {backlink.url_from}
                          </span>
                          <Button
                            variant="link"
                            className="p-0 h-auto"
                            onClick={() =>
                              window.open(backlink.url_from, "_blank")
                            }
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M13.5 2H5.5C5.36739 2 5.24021 2.05268 5.14645 2.14645C5.05268 2.24021 5 2.36739 5 2.5V5H2.5C2.36739 5 2.24021 5.05268 2.14645 5.14645C2.05268 5.24021 2 5.36739 2 5.5V13.5C2 13.6326 2.05268 13.7598 2.14645 13.8536C2.24021 13.9473 2.36739 14 2.5 14H10.5C10.6326 14 10.7598 13.9473 10.8536 13.8536C10.9473 13.7598 11 13.6326 11 13.5V11H13.5C13.6326 11 13.7598 10.9473 13.8536 10.8536C13.9473 10.7598 14 10.6326 14 10.5V2.5C14 2.36739 13.9473 2.24021 13.8536 2.14645C13.7598 2.05268 13.6326 2 13.5 2ZM10 13H3V6H10V13ZM13 10H11V5.5C11 5.36739 10.9473 5.24021 10.8536 5.14645C10.7598 5.05268 10.6326 5 10.5 5H6V3H13V10Z"
                                fill="black"
                              />
                            </svg>
                          </Button>
                        </div>
                      </TableCell>

                      <TableCell className="px-4 text-[13px]">
                        <div className="flex gap-2 items-center">
                          {backlink.inlink_rank || 0}
                          <Progress
                            value={backlink.inlink_rank || 0}
                            className="w-20 h-[10px] [&>div]:bg-[#7367F0] bg-[#F7F7F7] border border-[#DEE2E6]"
                          />
                        </div>
                      </TableCell>

                      <TableCell className="px-4 text-[13px]">
                        <div className="max-w-xs">
                          <div className="font-medium text-gray-900 mb-1 w-40 whitespace-nowrap text-ellipsis overflow-hidden">
                            {backlink.anchor || "No anchor text"}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="w-40 whitespace-nowrap text-ellipsis overflow-hidden font-semibold">
                              {backlink.url_to}
                            </span>
                            <Button
                              variant="link"
                              className="p-0 h-auto"
                              onClick={() =>
                                window.open(backlink.url_to, "_blank")
                              }
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  d="M13.5 2H5.5C5.36739 2 5.24021 2.05268 5.14645 2.14645C5.05268 2.24021 5 2.36739 5 2.5V5H2.5C2.36739 5 2.24021 5.05268 2.14645 5.14645C2.05268 5.24021 2 5.36739 2 5.5V13.5C2 13.6326 2.05268 13.7598 2.14645 13.8536C2.24021 13.9473 2.36739 14 2.5 14H10.5C10.6326 14 10.7598 13.9473 10.8536 13.8536C10.9473 13.7598 11 13.6326 11 13.5V11H13.5C13.6326 11 13.7598 10.9473 13.8536 10.8536C13.9473 10.7598 14 10.6326 14 10.5V2.5C14 2.36739 13.9473 2.24021 13.8536 2.14645C13.7598 2.05268 13.6326 2 13.5 2ZM10 13H3V6H10V13ZM13 10H11V5.5C11 5.36739 10.9473 5.24021 10.8536 5.14645C10.7598 5.05268 10.6326 5 10.5 5H6V3H13V10Z"
                                  fill="black"
                                />
                              </svg>
                            </Button>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="px-4 text-[13px]">
                        <Badge
                          className={`rounded-full shadow-none text-xs font-medium ${
                            !backlink.nofollow
                              ? "bg-emerald-50 text-emerald-600 hover:bg-[#cdfee1]"
                              : "bg-gray-100 text-gray-700 hover:bg-[#EBEBEB]"
                          }`}
                        >
                          {!backlink.nofollow ? "Dofollow" : "Nofollow"}
                        </Badge>
                      </TableCell>

                      <TableCell className="px-4 text-[13px]">
                        {formatDate(backlink.first_seen)}
                      </TableCell>
                      <TableCell className="px-4 text-[13px]">
                        {formatDate(backlink.last_visited)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {pagination && pagination.totalPages > 1 && !loading && (
            <div className="mt-6 flex justify-end">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (pagination.currentPage > 1) {
                          handlePageChange(pagination.currentPage - 1);
                        }
                      }}
                      className={
                        !pagination.hasPrevPage
                          ? "pointer-events-none opacity-50"
                          : ""
                      }
                    />
                  </PaginationItem>

                  {Array.from(
                    { length: Math.min(5, pagination.totalPages) },
                    (_, i) => {
                      let pageNum;
                      if (pagination.totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (pagination.currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (
                        pagination.currentPage >=
                        pagination.totalPages - 2
                      ) {
                        pageNum = pagination.totalPages - 4 + i;
                      } else {
                        pageNum = pagination.currentPage - 2 + i;
                      }

                      return (
                        <PaginationItem key={pageNum}>
                          <PaginationLink
                            className={
                              pagination.currentPage === pageNum
                                ? "bg-gray-900 text-white"
                                : ""
                            }
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              handlePageChange(pageNum);
                            }}
                            isActive={pagination.currentPage === pageNum}
                          >
                            {pageNum}
                          </PaginationLink>
                        </PaginationItem>
                      );
                    }
                  )}

                  {pagination.totalPages > 5 &&
                    pagination.currentPage < pagination.totalPages - 2 && (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    )}

                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (pagination.currentPage < pagination.totalPages) {
                          handlePageChange(pagination.currentPage + 1);
                        }
                      }}
                      className={
                        !pagination.hasNextPage
                          ? "pointer-events-none opacity-50"
                          : ""
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BacklinkDashboard;
