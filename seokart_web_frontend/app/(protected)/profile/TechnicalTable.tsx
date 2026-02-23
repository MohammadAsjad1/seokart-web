"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getUserActivities,
  deleteActivity,
  startSitemapCrawl,
  stopSitemapCrawl,
} from "@/store/slices/scraperSlice";
import {
  initializeSocket,
  disconnectSocket,
  requestActivities,
} from "@/store/middlewares/socketMiddleware";
import {
  ExternalLink,
  RefreshCcw,
  Trash,
  ChevronDown,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import AccordionContent from "./AccordionContent";
import { showToast } from "@/lib/toast";
import { ConfirmDialog } from "@/components/ui/Alert";

interface Activity {
  _id: string;
  websiteUrl: string;
  status: string;
  progress: number;
  isSitemapCrawling: number;
  isWebpageCrawling: number;
  isBacklinkFetching?: number;
  sitemapCount: number;
  webpageCount: number;
  webpagesSuccessful?: number;
  webpagesFailed?: number;
  startTime: string;
  lastCrawlStarted?: string;
  lastCrawlUpdated?: string;
  estimatedTimeRemaining?: number;
  createdAt?: string;
  updatedAt?: string;
}

export default function TechnicalTable() {
  const dispatch = useAppDispatch();
  const {
    activities: contextActivities,
    loading,
    deleteLoading,
  } = useAppSelector((state) => state.scraper);

  const { isConnected, userActivities } = useAppSelector(
    (state) => state.socket
  );

  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [localDeleteLoading, setLocalDeleteLoading] = useState<{
    [key: string]: boolean;
  }>({});
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [activityToDelete, setActivityToDelete] = useState<Activity | null>(
    null
  );
  const [apiError, setApiError] = useState<string | null>(null);

  const activities = useMemo(() => {
    return userActivities.length > 0 ? userActivities : contextActivities || [];
  }, [userActivities, contextActivities]);

  const hasProcessingActivity = useMemo(() => {
    return activities.some(
      (activity) =>
        activity.isSitemapCrawling === 1 ||
        activity.isWebpageCrawling === 1 ||
        activity.isBacklinkFetching === 1 ||
        activity.status === "processing"
    );
  }, [activities]);

  const fetchActivities = useCallback(() => {
    if (!isConnected) {
      dispatch(getUserActivities()).catch((error) => {
        if (
          error?.message &&
          !error.message.includes("User activity is empty")
        ) {
          setApiError("Failed to load activities. Please refresh the page.");
        }
      });
    }
  }, [dispatch, isConnected]);

  useEffect(() => {
    dispatch(initializeSocket() as any);
    fetchActivities();

    return () => {
      dispatch(disconnectSocket() as any);
    };
  }, [dispatch]);

  useEffect(() => {
    if (hasProcessingActivity && isConnected) {
      const intervalId = setInterval(() => {
        dispatch(requestActivities() as any);
      }, 5000);
      return () => clearInterval(intervalId);
    }
  }, [hasProcessingActivity, isConnected, dispatch]);

  const formatMongoDate = useCallback(
    (dateString: string | undefined): string => {
      if (!dateString) return "—";

      try {
        const date = new Date(dateString);
        const options: Intl.DateTimeFormatOptions = {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        };

        return new Intl.DateTimeFormat("en-US", options)
          .format(date)
          .replace(",", " •");
      } catch {
        return dateString || "—";
      }
    },
    []
  );

  const handleStopCrawl = useCallback(
    async (e: React.MouseEvent, activity: Activity) => {
      e.stopPropagation();

      const isProcessing =
        activity.isSitemapCrawling === 1 || activity.isWebpageCrawling === 1;

      if (!isProcessing) {
        showToast("No active crawl to stop", "info");
        return;
      }

      try {
        showToast("Stopping crawl...", "info");
        await dispatch(stopSitemapCrawl(activity._id)).unwrap();
        showToast("Crawl stopped successfully", "success");
      } catch (error: any) {
        showToast(error || "Failed to stop crawl", "error");
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

  const toggleRow = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedRow((prev) => (prev === id ? null : id));
  }, []);

  const isActivityCompleted = useCallback((activity: Activity) => {
    return (
      activity.status === "completed" ||
      activity.status === "failed" ||
      activity.status === "stopped"
    );
  }, []);

  const handleRecrawl = useCallback(
    async (e: React.MouseEvent, activity: Activity) => {
      e.stopPropagation();

      if (!isActivityCompleted(activity)) {
        showToast("Can only recrawl completed activities", "error");
        return;
      }

      try {
        showToast("Starting recrawl...", "info");
        await dispatch(
          startSitemapCrawl({ websiteUrl: activity.websiteUrl })
        ).unwrap();

        showToast("Recrawl started successfully", "success");
      } catch (error: any) {
        showToast(error.message || "Failed to start recrawl. Please try again.", "error");
      }
    },
    [isActivityCompleted, dispatch]
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, activity: Activity) => {
      e.stopPropagation();

      if (!isActivityCompleted(activity)) {
        showToast("Can only delete completed activities", "info");
        return;
      }

      setActivityToDelete(activity);
      setConfirmDialogOpen(true);
    },
    [isActivityCompleted]
  );

  const confirmDelete = useCallback(async () => {
    if (!activityToDelete) return;

    setLocalDeleteLoading((prev) => ({
      ...prev,
      [activityToDelete._id]: true,
    }));

    try {
      showToast("Deleting activity...", "info");

      await dispatch(deleteActivity(activityToDelete._id)).unwrap();

      showToast("Activity deleted successfully", "success");

      setConfirmDialogOpen(false);
      setActivityToDelete(null);
    } catch (error: any) {
      showToast("Failed to delete activity", "error");
    } finally {
      setLocalDeleteLoading((prev) => ({
        ...prev,
        [activityToDelete._id]: false,
      }));
    }
  }, [activityToDelete, dispatch]);

  const getStatusBadge = useCallback((activity: Activity) => {
    const isProcessing =
      activity.isSitemapCrawling === 1 ||
      activity.isWebpageCrawling === 1 ||
      activity.status === "processing";

    const status =
      activity.status === "stopping"
        ? "stopping"
        : activity.status === "stopped"
        ? "stopped"
        : activity.status === "rate_limited"
        ? "rate_limited"
        : isProcessing
        ? "processing"
        : activity.status;

    switch (status) {
      case "completed":
        return (
          <Badge className="bg-success font-normal bg-[#cdfee1] rounded-full text-black shadow-none hover:bg-[#cdfee1]">
            Completed
          </Badge>
        );
      case "stopped":
        return (
          <Badge className="bg-warning font-normal bg-orange-100 rounded-full text-orange-800 shadow-none hover:bg-orange-100">
            Stopped
          </Badge>
        );
      case "stopping":
        return (
          <Badge className="bg-warning font-normal bg-orange-100 rounded-full text-orange-800 shadow-none hover:bg-orange-100">
            Stopping...
          </Badge>
        );
      case "rate_limited":
        return (
          <Badge className="bg-destructive font-normal bg-red-100 rounded-full text-red-800 shadow-none hover:bg-red-100">
            Rate Limited
          </Badge>
        );
      case "processing":
        return (
          <div role="status" className="flex items-center space-x-2">
            <svg
              aria-hidden="true"
              className="w-[21px] h-[21px] text-gray-200 animate-spin dark:text-gray-600 fill-black"
              viewBox="0 0 100 101"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C0 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                fill="currentColor"
              />
              <path
                d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                fill="currentFill"
              />
            </svg>
            <span className="text-xs text-gray-600">
              {activity.isSitemapCrawling === 1 && "Sitemap"}
              {activity.isWebpageCrawling === 1 && "Webpage"}
            </span>
            <span className="sr-only">Loading...</span>
          </div>
        );
      case "pending":
        return (
          <Badge className="bg-warning font-normal bg-yellow-100 rounded-full text-yellow-800 shadow-none hover:bg-yellow-100">
            Pending
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-destructive font-normal bg-red-100 rounded-full text-red-800 shadow-none hover:bg-red-100">
            Failed
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gray-200 font-normal rounded-full text-gray-800 shadow-none hover:bg-gray-200">
            {status}
          </Badge>
        );
    }
  }, []);

  return (
    <div className="card bg-white rounded-xl px-4 py-4">
      <Tabs defaultValue="pages" className="w-full relative">
        <div className="table-head flex justify-between">
          <div className="table-headLeft">
            <TabsList className="grid w-full grid-cols-2 bg-transparent p-0">
              <TabsTrigger value="pages" className="text-[13px] text-black">
                Sitemap Stats & Progress
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            ></div>
            <span className="text-xs text-gray-600">
              {isConnected ? "Live Updates" : "Disconnected"}
            </span>
          </div>
        </div>

        <div className="mt-4">
          <TabsContent value="pages">
            {loading && activities.length === 0 ? (
              <div className="flex justify-center p-8">
                <div role="status">
                  <svg
                    aria-hidden="true"
                    className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-black"
                    viewBox="0 0 100 101"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C0 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                      fill="currentColor"
                    />
                    <path
                      d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                      fill="currentFill"
                    />
                  </svg>
                  <span className="sr-only">Loading...</span>
                </div>
              </div>
            ) : apiError ? (
              <div className="text-yellow-600 p-4 text-center bg-yellow-50 rounded-lg border border-yellow-200">
                <p className="font-medium">{apiError}</p>
                <button
                  onClick={() => {
                    setApiError(null);
                    fetchActivities();
                  }}
                  className="mt-2 text-sm underline hover:no-underline"
                >
                  Retry
                </button>
              </div>
            ) : activities.length === 0 ? (
              <div className="text-gray-500 p-4 text-center">
                No sitemap crawling activities found. Start a new crawl to see
                results here.
              </div>
            ) : (
              <div className="border-table border border-[#dee2e6] rounded-xl">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="bg-[#F7F7F7] rounded-tl-xl text-black font-semibold text-[13px] px-4 w-[50px]"></TableHead>
                      <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                        Website URL
                      </TableHead>
                      <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                        Status
                      </TableHead>
                      <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                        Sitemaps Found
                      </TableHead>
                      <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                        Webpages Crawled
                      </TableHead>
                      <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                        First Crawled At
                      </TableHead>
                      <TableHead className="bg-[#F7F7F7] text-black font-semibold text-[13px] px-4">
                        Last Crawled At
                      </TableHead>
                      <TableHead className="bg-[#F7F7F7] rounded-tr-xl text-black font-semibold text-[13px] px-4">
                        Action
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {activities.map((activity) => {
                      const isCompleted = isActivityCompleted(activity);
                      const isDeleting =
                        localDeleteLoading[activity._id] ||
                        deleteLoading?.[activity._id] ||
                        false;
                      const isProcessing =
                        activity.isSitemapCrawling === 1 ||
                        activity.isWebpageCrawling === 1;

                      const isStopped = activity.status === "stopped";

                      return (
                        <React.Fragment key={activity._id}>
                          <TableRow
                            className="hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={(e) => toggleRow(activity._id, e)}
                          >
                            <TableCell className="px-4 text-[13px] text-black">
                              <div className="flex items-center justify-center transition-transform duration-200">
                                {expandedRow === activity._id ? (
                                  <ChevronDown size={18} />
                                ) : (
                                  <ChevronRight size={18} />
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="px-4 text-[13px] text-black">
                              <div className="flex items-center gap-2 group">
                                <span className="text-blue-600 group-hover:text-blue-800">
                                  {activity.websiteUrl}
                                </span>
                                <button
                                  onClick={(e) =>
                                    handleExternalLinkClick(
                                      e,
                                      activity.websiteUrl
                                    )
                                  }
                                  className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-gray-500 hover:text-blue-600"
                                  title="Open in new tab"
                                >
                                  <ExternalLink size={16} />
                                </button>
                              </div>
                            </TableCell>

                            <TableCell className="px-4 text-[13px] text-black">
                              {getStatusBadge(activity)}
                            </TableCell>

                            <TableCell className="px-4 text-[13px] text-black">
                              <span
                                className={
                                  activity.isSitemapCrawling === 1
                                    ? "animate-pulse"
                                    : ""
                                }
                              >
                                {activity.sitemapCount || 0}
                              </span>
                            </TableCell>

                            <TableCell className="px-4 text-[13px] text-black">
                              <span
                                className={
                                  activity.isWebpageCrawling === 1
                                    ? "animate-pulse"
                                    : ""
                                }
                              >
                                {activity.webpagesSuccessful || 0}/
                                {activity.webpageCount || 0}
                              </span>
                            </TableCell>

                            <TableCell className="px-4 text-[13px] text-black">
                              {formatMongoDate(activity.createdAt || "")}
                            </TableCell>

                            <TableCell className="px-4 text-[13px] text-black">
                              {formatMongoDate(activity.updatedAt || "")}
                            </TableCell>

                            <TableCell className="px-4 text-[13px] text-black">
                              <div
                                className="flex items-center gap-1.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        className="custom-btn w-[30px] h-[30px] flex items-center justify-center rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={(e) =>
                                          isProcessing
                                            ? handleStopCrawl(e, activity)
                                            : handleRecrawl(e, activity)
                                        }
                                        disabled={
                                          activity.status === "stopping"
                                        }
                                      >
                                        {activity.status === "stopping" ? (
                                          <Loader2
                                            size={16}
                                            color="#ffffff"
                                            className="animate-spin"
                                          />
                                        ) : isProcessing ? (
                                          <X size={16} color="#ffffff" />
                                        ) : (
                                          <RefreshCcw
                                            size={16}
                                            color="#ffffff"
                                          />
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      className="bg-black text-white px-3 py-1 text-xs rounded-md shadow-md"
                                    >
                                      {activity.status === "stopping"
                                        ? "Stopping..."
                                        : isProcessing
                                        ? "Stop crawl"
                                        : isCompleted
                                        ? "Crawl again"
                                        : "Wait for completion"}
                                      <TooltipPrimitive.Arrow className="fill-black" />
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        className="custom-btn danger-btn w-[30px] h-[30px] flex items-center justify-center rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={(e) =>
                                          handleDelete(e, activity)
                                        }
                                        disabled={
                                          isStopped
                                            ? false
                                            : !isCompleted || isDeleting
                                        }
                                      >
                                        {isDeleting ? (
                                          <Loader2
                                            size={16}
                                            color="#ffffff"
                                            className="animate-spin"
                                          />
                                        ) : (
                                          <Trash size={16} color="#ffffff" />
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      className="bg-black text-white px-3 py-1 text-xs rounded-md shadow-md"
                                    >
                                      {!isCompleted
                                        ? "Wait for completion"
                                        : isDeleting
                                        ? "Deleting..."
                                        : "Delete"}
                                      <TooltipPrimitive.Arrow className="fill-black" />
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                            </TableCell>
                          </TableRow>

                          {expandedRow === activity._id && (
                            <TableRow>
                              <TableCell colSpan={9} className="p-0">
                                <div className="overflow-hidden animate-slideDown">
                                  <AccordionContent activityId={activity._id} />
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>

      <ConfirmDialog
        isOpen={confirmDialogOpen}
        onClose={() => {
          if (!activityToDelete || !localDeleteLoading[activityToDelete._id]) {
            setConfirmDialogOpen(false);
            setActivityToDelete(null);
          }
        }}
        onConfirm={confirmDelete}
        isLoading={
          activityToDelete ? localDeleteLoading[activityToDelete._id] : false
        }
      />
    </div>
  );
}
