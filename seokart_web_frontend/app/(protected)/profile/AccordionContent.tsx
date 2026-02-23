"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchWebpages, scrapeWebpage } from "@/store/slices/scraperSlice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink, RefreshCcw } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Drawer } from "@/components/ui/drawer";
import OptimizeSidebar from "./OptimizeSidebar";
import ErrorTab from "./ErrorTab";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import DropdownCustom from "../../components/dropdown";
import { getScoreColor, getStatusBadge } from "../../components/scraperUtils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { showToast } from "@/lib/toast";

interface AccordionContentProps {
  activityId: string;
}

const dropdownPageFilter = [
  { value: "lastFetched", label: "Latest" },
  { value: "lastFetched_asc", label: "Oldest" },
  { value: "seoScore", label: "SEO Score - High to Low" },
  { value: "seoScore_asc", label: "SEO Score - Low to High" },
  { value: "statusCode", label: "Status - Success First" },
  { value: "statusCode_asc", label: "Status - Failed First" },
];

const POLLING_INTERVAL = 3000;

export default function AccordionContent({
  activityId,
}: AccordionContentProps) {
  const dispatch = useAppDispatch();
  const {
    webpages,
    pagination,
    webpageLoading: loading,
    singleScrapeLoading,
  } = useAppSelector((state) => state.scraper);

  const [currentPage, setCurrentPage] = useState(1);
  const [limit] = useState(10);
  const [initialized, setInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState("webpages");
  const [errorCounts, setErrorCounts] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedWebpage, setSelectedWebpage] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortValue, setSortValue] = useState("lastFetched");
  const [pollingWebpageIds, setPollingWebpageIds] = useState<Set<string>>(
    new Set()
  );
  const [fetchError, setFetchError] = useState<string | null>(null);

  const getPositiveRelativeTime = useCallback((dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes} minutes ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hours ago`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) return `${diffInDays} days ago`;

    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) return `${diffInMonths} months ago`;

    const diffInYears = Math.floor(diffInMonths / 12);
    return `${diffInYears} years ago`;
  }, []);

  const fetchWebpagesWithFilters = useCallback(() => {
    const [sortField, sortOrder] = sortValue.includes("_")
      ? sortValue.split("_")
      : [sortValue, "desc"];

    const params: any = {
      activityId,
      page: currentPage,
      limit,
      sort: sortField,
      order: sortOrder === "asc" ? "asc" : "desc",
    };

    if (searchTerm && searchTerm.trim() !== "") {
      params.search = searchTerm.trim();
    }

    dispatch(fetchWebpages(params))
      .unwrap()
      .then((response) => {
        setFetchError(null);
        if (response?.data?.errorCounts) {
          setErrorCounts(response.data.errorCounts);
        }
      })
      .catch((error) => {
        if (error && typeof error === 'string' && !error.includes("No webpages found")) {
          setFetchError("Failed to load webpages. Please try again.");
        }
      });
  }, [activityId, currentPage, limit, sortValue, searchTerm, dispatch]);

  const handleScrapeWebpage = useCallback(
    async (e: React.MouseEvent, webpage: any) => {
      e.stopPropagation();
      try {
        // setPollingWebpageIds((prev) => new Set(prev).add(webpage._id));
        const response = await dispatch(
          scrapeWebpage({
            websiteUrl: webpage.websiteUrl,
            pageUrl: webpage.pageUrl,
            webpageId: webpage._id,
          })
        ).unwrap();

        if(response){
          showToast("Webpage recrawled successfully", "success");
          fetchWebpagesWithFilters();
        }
      } catch (error: any) {
        // setPollingWebpageIds((prev) => {
        //   const newSet = new Set(prev);
        //   newSet.delete(webpage._id);
        //   return newSet;
        // });
        showToast(error?.message || error?.response?.data?.message || error?.error || "Failed to recrawl webpage", "error");
      }
    },
    [dispatch]
  );

  const handleExternalLinkClick = useCallback(
    (e: React.MouseEvent, url: string) => {
      e.stopPropagation();
      window.open(url, "_blank", "noopener,noreferrer");
    },
    []
  );

  const handleRowClick = useCallback((webpage: any) => {
    setSelectedWebpage(webpage);
    setIsDrawerOpen(true);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const isWebpageLoading = useCallback(
    (webpageId: string) => {
      return singleScrapeLoading[webpageId] || false;
    },
    [singleScrapeLoading]
  );

  useEffect(() => {
    if (pollingWebpageIds.size > 0) {
      const intervalId = setInterval(() => {
        fetchWebpagesWithFilters();
        const currentWebpages = webpages.filter((wp) =>
          pollingWebpageIds.has(wp._id)
        );
        const allProcessed = currentWebpages.every((wp) => wp.isProcessed);

        if (allProcessed) {
          setPollingWebpageIds(new Set());
        }
      }, POLLING_INTERVAL);

      return () => clearInterval(intervalId);
    }
  }, [pollingWebpageIds, fetchWebpagesWithFilters, webpages]);

  useEffect(() => {
    if (activityId && !initialized && activeTab === "webpages") {
      setInitialized(true);
      fetchWebpagesWithFilters();
    }
  }, [activityId, initialized, activeTab, fetchWebpagesWithFilters]);

  // Refetch when page or sort changes only (initialized not in deps to avoid double call when Effect 1 sets it)
  useEffect(() => {
    if (initialized && activityId && activeTab === "webpages") {
      fetchWebpagesWithFilters();
    }
  }, [currentPage, sortValue, activityId, activeTab]);

  useEffect(() => {
    if (initialized && activityId && activeTab === "webpages") {
      const delayDebounceFn = setTimeout(() => {
        setCurrentPage(1);
        fetchWebpagesWithFilters();
      }, 500);

      return () => clearTimeout(delayDebounceFn);
    }
  }, [searchTerm]);

  const renderPaginationItems = useMemo(() => {
    if (!pagination) return null;

    const items = [];
    const totalPages = pagination.pages;

    items.push(
      <PaginationItem key="page-1">
        <PaginationLink
          href="#"
          isActive={currentPage === 1}
          onClick={(e) => {
            e.preventDefault();
            handlePageChange(1);
          }}
        >
          1
        </PaginationLink>
      </PaginationItem>
    );

    if (currentPage > 3) {
      items.push(
        <PaginationItem key="ellipsis-1">
          <PaginationEllipsis />
        </PaginationItem>
      );
    }

    for (
      let i = Math.max(2, currentPage - 1);
      i <= Math.min(totalPages - 1, currentPage + 1);
      i++
    ) {
      if (i === 1 || i === totalPages) continue;

      items.push(
        <PaginationItem key={`page-${i}`}>
          <PaginationLink
            href="#"
            isActive={currentPage === i}
            onClick={(e) => {
              e.preventDefault();
              handlePageChange(i);
            }}
          >
            {i}
          </PaginationLink>
        </PaginationItem>
      );
    }

    if (currentPage < totalPages - 2) {
      items.push(
        <PaginationItem key="ellipsis-2">
          <PaginationEllipsis />
        </PaginationItem>
      );
    }

    if (totalPages > 1) {
      items.push(
        <PaginationItem key={`page-${totalPages}`}>
          <PaginationLink
            href="#"
            isActive={currentPage === totalPages}
            onClick={(e) => {
              e.preventDefault();
              handlePageChange(totalPages);
            }}
          >
            {totalPages}
          </PaginationLink>
        </PaginationItem>
      );
    }

    return items;
  }, [pagination, currentPage, handlePageChange]);

  const renderSkeletonRows = useMemo(() => {
    return Array.from({ length: 10 }).map((_, index) => (
      <TableRow key={`skeleton-${index}`}>
        <TableCell className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4"></div>
        </TableCell>
        <TableCell className="px-4 py-3">
          <div className="h-6 bg-gray-200 rounded-full animate-pulse w-20"></div>
        </TableCell>
        <TableCell className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-24"></div>
        </TableCell>
        <TableCell className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-12"></div>
        </TableCell>
        <TableCell className="px-4 py-3">
          <div className="h-8 bg-gray-200 rounded animate-pulse w-16"></div>
        </TableCell>
      </TableRow>
    ));
  }, []);

  return (
    <>
      <div className="bg-gray-50 border-t border-gray-200">
        <div className="p-2">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <div className="table-head flex justify-between">
              <div className="table-headLeft">
                <TabsList className="grid w-full grid-cols-2 bg-transparent p-0 mb-2">
                  <TabsTrigger
                    value="webpages"
                    className="text-[13px] text-black"
                  >
                    Pages
                  </TabsTrigger>
                  <TabsTrigger
                    value="errors"
                    className="text-[13px] text-black"
                  >
                    Errors
                  </TabsTrigger>
                </TabsList>
              </div>
              {activeTab === "webpages" && (
                <div className="tab-headRight flex gap-4">
                  <div className="relative flex-1 max-w-80">
                    <input
                      id="search_input"
                      className="h-[38px] peer w-full bg-transparent placeholder:text-gray-400 placeholder:text-xs text-black text-xs border border-[#dee2e6] rounded-md px-3 py-3 transition duration-300 ease focus:outline-none focus:border-slate-400 hover:border-slate-300"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      disabled={loading}
                      placeholder="Search webpages urls..."
                    />
                  </div>
                  <div className="w-[200px] text-xs">
                    <DropdownCustom
                      options={dropdownPageFilter}
                      placeholder="Sort by..."
                      value={sortValue}
                      onValueChange={setSortValue}
                      disabled={loading}                 
                     />
                  </div>
                </div>
              )}
            </div>

            <TabsContent value="webpages">
              {fetchError ? (
                <div className="text-yellow-600 p-4 text-center bg-yellow-50 rounded-lg border border-yellow-200">
                  <p className="font-medium">{fetchError}</p>
                  <button
                    onClick={() => {
                      setFetchError(null);
                      fetchWebpagesWithFilters();
                    }}
                    className="mt-2 text-sm underline hover:no-underline"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="border border-[#dee2e6] rounded-xl bg-white">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="bg-[#F7F7F7] rounded-tl-xl text-black font-semibold text-[13px] px-4">
                          Web Page URL
                        </TableHead>
                        <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                          Status
                        </TableHead>
                        <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                          Last Fetched
                        </TableHead>
                        <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                          Score
                        </TableHead>
                        <TableHead className="bg-[#F7F7F7] rounded-tr-xl text-black font-semibold text-[13px] px-4 w-[100px]">
                          Re-Crawl
                        </TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {loading && renderSkeletonRows}

                      {!loading && webpages.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-center py-8 text-gray-500"
                          >
                            No webpages found.
                          </TableCell>
                        </TableRow>
                      )}

                      {!loading &&
                        webpages.map((webpage) => {
                          const isLoading = isWebpageLoading(webpage._id);
                          const showProcessingState =
                            isLoading || !webpage.isProcessed;
                          const hasErrors = webpage.hasErrors;

                          return (
                            <TableRow
                              key={webpage._id}
                              className="hover:bg-gray-50 cursor-pointer transition-colors"
                              onClick={() => handleRowClick(webpage)}
                            >
                              <TableCell className="px-4 text-[13px]">
                                <div className="flex items-center gap-2 group">
                                  <span className="text-blue-600 group-hover:text-blue-800">
                                    {webpage.pageUrl}
                                  </span>
                                  <button
                                    onClick={(e) =>
                                      handleExternalLinkClick(e, webpage.pageUrl)
                                    }
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-blue-600 cursor-pointer"
                                    title="Open in new tab"
                                  >
                                    <ExternalLink size={16} />
                                  </button>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 text-[13px]">
                                {getStatusBadge(
                                  hasErrors ? 500 : (webpage.statusCode ?? 0)
                                )}
                              </TableCell>
                              <TableCell className="px-4 text-[13px]">
                                {hasErrors ? (
                                  <div className="px-4 text-[13px] text-gray-400">
                                    --
                                  </div>
                                ) : showProcessingState ? (
                                  <div className="flex items-center gap-2">
                                    <div className="animate-spin">
                                      <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                      >
                                        <circle
                                          cx="12"
                                          cy="12"
                                          r="3"
                                          fill="currentColor"
                                        >
                                          <animate
                                            attributeName="r"
                                            values="3;6;3"
                                            dur="1s"
                                            repeatCount="indefinite"
                                          />
                                          <animate
                                            attributeName="opacity"
                                            values="1;0.3;1"
                                            dur="1s"
                                            repeatCount="indefinite"
                                          />
                                        </circle>
                                      </svg>
                                    </div>
                                    <span className="text-orange-600">
                                      Processing...
                                    </span>
                                  </div>
                                ) : (
                                  getPositiveRelativeTime(
                                    webpage.lastCrawled || webpage.updatedAt
                                  )
                                )}
                              </TableCell>
                              <TableCell
                                className={`px-4 text-[13px] ${
                                  showProcessingState
                                    ? "text-gray-400"
                                    : getScoreColor(webpage.seoScore)
                                } font-semibold text-xl`}
                              >
                                {showProcessingState
                                  ? "--"
                                  : `${webpage.seoScore}%`}
                              </TableCell>
                              <TableCell className="px-4 text-[13px]">
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={(e) =>
                                          handleScrapeWebpage(e, webpage)
                                        }
                                        disabled={isLoading}
                                        className={`custom-btn w-[30px] h-[30px] flex items-center justify-center rounded-lg transition-all border border-transparent text-white ${
                                          isLoading
                                            ? "bg-gray-400 cursor-not-allowed"
                                            : "bg-blue-600 hover:bg-blue-700"
                                        }`}
                                      >
                                        {isLoading ? (
                                          <svg
                                            className="animate-spin h-4 w-4 text-white"
                                            xmlns="http://www.w3.org/2000/svg"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                          >
                                            <circle
                                              className="opacity-25"
                                              cx="12"
                                              cy="12"
                                              r="10"
                                              stroke="currentColor"
                                              strokeWidth="4"
                                            ></circle>
                                            <path
                                              className="opacity-75"
                                              fill="currentColor"
                                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                            ></path>
                                          </svg>
                                        ) : (
                                          <RefreshCcw size={16} color="#ffffff" />
                                        )}
                                      </button>
                                    </TooltipTrigger>

                                    <TooltipContent
                                      side="top"
                                      className="bg-black text-white px-3 py-1 text-xs rounded-md shadow-md"
                                    >
                                      Crawl again
                                      <TooltipPrimitive.Arrow className="fill-black" />
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {pagination && pagination.pages > 1 && (
                <div className="paginationBox flex items-center justify-between mt-4">
                  <div className="whitespace-nowrap font-semibold text-sm text-gray-600">
                    {`${(currentPage - 1) * limit + 1}-${Math.min(
                      currentPage * limit,
                      pagination.total
                    )} of ${pagination.total} results`}
                  </div>
                  <Pagination className="justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage > 1) {
                              handlePageChange(currentPage - 1);
                            }
                          }}
                        />
                      </PaginationItem>

                      {renderPaginationItems}

                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            if (pagination && currentPage < pagination.pages) {
                              handlePageChange(currentPage + 1);
                            }
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </TabsContent>

            <TabsContent value="errors">
              <ErrorTab
                activityId={activityId}
                errorCounts={errorCounts}
                onWebpageClick={handleRowClick}
                onExternalLinkClick={handleExternalLinkClick}
                onScrapeWebpage={handleScrapeWebpage}
                isWebpageLoading={isWebpageLoading}
                getScoreColor={getScoreColor}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Drawer
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        direction="right"
      >
        {selectedWebpage && <OptimizeSidebar webpage={selectedWebpage} />}
      </Drawer>
    </>
  );
}