"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  flexRender,
} from "@tanstack/react-table";
import { ArrowUpDown, Trash2, Smartphone, Monitor, Tablet } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/useToast";
import AnalyticsModal from "./AnalyticsModal";
import { KeywordAnalysisData } from "@/types/rankTracker";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getDashboardRankings,
  bulkRemoveKeywords,
  getKeywordAnalysis,
} from "@/store/slices/rankTrackerSlice";

export type RankingData = {
  id: string;
  keywords: string;
  myRankings: string | React.ReactNode;
  competitors: Array<{
    name: string;
    ranking: string | React.ReactNode;
    aiTracking: {
      chatgpt: boolean | null;
      aiMode: boolean | null;
      aiOverview: boolean | null;
    };
  }>;
  location: string;
  device: string;
  lastUpdated: string;
  isDataFetched: boolean;
  tags: string[];
  targetAI: {
    chatgpt: boolean | null;
    aiMode: boolean | null;
    aiOverview: boolean | null;
  };
};

const transformApiData = (apiData: Array<any>): RankingData[] => {
  return apiData.map((keyword: any) => {
    const competitors = keyword.competitors || [];

    return {
      id: keyword.keywordId,
      keywords: keyword.keyword,
      myRankings: keyword.isDataFetched ? (
        keyword.target?.currentPosition ? (
          keyword.target.currentPosition.toString()
        ) : (
          ">100"
        )
      ) : (
        <LoadingSpinner size="small" color="#00" />
      ),
      competitors: competitors.map((comp: any) => ({
        name: comp.name || "Competitor",
        ranking: keyword.isDataFetched ? (
          comp.currentPosition ? (
            comp.currentPosition.toString()
          ) : (
            ">100"
          )
        ) : (
          <LoadingSpinner size="small" color="#00" />
        ),
        aiTracking: comp.aiTracking || {
          chatgpt: null,
          aiMode: null,
          aiOverview: null,
        },
      })),
      tags: keyword.tags || [],
      location: keyword.location,
      device: keyword.device,
      lastUpdated: keyword.lastUpdated,
      isDataFetched: keyword.isDataFetched,
      targetAI: keyword.target?.aiTracking || {
        chatgpt: null,
        aiMode: null,
        aiOverview: null,
      },
    };
  });
};

const getMaxCompetitors = (apiData: Array<any>): number => {
  if (!apiData || apiData.length === 0) return 0;

  return Math.max(
    ...apiData.map((keyword: any) => (keyword.competitors || []).length)
  );
};

const getCompetitorNames = (
  apiData: Array<any>,
  maxCompetitors: number
): string[] => {
  if (!apiData || apiData.length === 0 || maxCompetitors === 0) return [];

  const competitorNames: string[] = [];

  for (let i = 0; i < maxCompetitors; i++) {
    const namesAtPosition = apiData
      .map((keyword: any) => keyword.competitors?.[i]?.name)
      .filter(Boolean);

    if (namesAtPosition.length > 0) {
      competitorNames[i] = namesAtPosition[0] || `Competitor ${i + 1}`;
    } else {
      competitorNames[i] = `Competitor ${i + 1}`;
    }
  }

  return competitorNames;
};

const AIIcons = ({
  aiTracking,
  isDataFetched,
}: {
  aiTracking: {
    chatgpt: boolean | null;
    aiMode: boolean | null;
    aiOverview: boolean | null;
  };
  isDataFetched: boolean;
}) => {
  if (!isDataFetched) {
    return null;
  }

  return (
    <ul className="flex justify-center gap-2">
      <li
        className={
          aiTracking.aiMode === true
            ? "keyword-iconActive"
            : "keyword-iconDisabled"
        }
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Image
              src="/images/google-ai-mode-icon.svg"
              alt="google-ai-mode-icon"
              width="20"
              height="20"
              style={{
                filter:
                  aiTracking.aiMode === true
                    ? "none"
                    : "grayscale(100%) opacity(0.5)",
              }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>
              Google AI Mode{" "}
              {aiTracking.aiMode === true ? "(Active)" : "(Inactive)"}
            </p>
          </TooltipContent>
        </Tooltip>
      </li>
      <li
        className={
          aiTracking.aiOverview === true
            ? "keyword-iconActive"
            : "keyword-iconDisabled"
        }
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Image
              src="/images/ai-overview-icon.svg"
              alt="ai-overview-icon"
              width="20"
              height="20"
              style={{
                filter:
                  aiTracking.aiOverview === true
                    ? "none"
                    : "grayscale(100%) opacity(0.5)",
              }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>
              AI Overview{" "}
              {aiTracking.aiOverview === true ? "(Active)" : "(Inactive)"}
            </p>
          </TooltipContent>
        </Tooltip>
      </li>
      <li
        className={
          aiTracking.chatgpt === true
            ? "keyword-iconActive"
            : "keyword-iconDisabled"
        }
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Image
              src="/images/chat-gpt-icon.svg"
              alt="chat-gpt-icon"
              width="20"
              height="20"
              style={{
                filter:
                  aiTracking.chatgpt === true
                    ? "none"
                    : "grayscale(100%) opacity(0.5)",
              }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>
              ChatGPT {aiTracking.chatgpt === true ? "(Active)" : "(Inactive)"}
            </p>
          </TooltipContent>
        </Tooltip>
      </li>
    </ul>
  );
};

const AnalyticsButton = ({
  keywordId,
  keyword,
  onAnalyticsClick,
}: {
  keywordId: string;
  keyword: string;
  onAnalyticsClick: (keywordId: string, keyword: string) => void;
}) => {
  const handleClick = () => {
    onAnalyticsClick(keywordId, keyword);
  };

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleClick}
            className="hover:opacity-75 transition-opacity rankingModal-btn"
          >
            <Image
              className="cursor-pointer"
              src="/images/eye-icon.svg"
              alt="eye-icon"
              width="20"
              height="20"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-black text-white px-3 py-1 text-xs rounded-md shadow-md"
        >
          View detailed analytics for &quot;{keyword}&quot;
          <TooltipPrimitive.Arrow className="fill-black" />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

function CountryFlag({ code }: { code: string }) {
  return <span className={`fi fi-${code.toLowerCase()} text-sm`} />;
}

function GetCountryCode(location:string) {
  const countryCodes = {
    "United States": "us",
    India: "in",
    "United Kingdom": "gb",
    Canada: "ca",
    Australia: "au",
    Germany: "de",
    France: "fr",
    Italy: "it",
    Spain: "es",
    Brazil: "br",
    Russia: "ru",
    Japan: "jp",
    Mexico: "mx",
    Indonesia: "id",
    Turkey: "tr",
    "South Korea": "kr",
  };

  return countryCodes[location as keyof typeof countryCodes] || "us";
}

function DeviceIcon({ device }: { device: string }) {
  const deviceLower = device?.toLowerCase() || "";

  if (deviceLower.includes("mobile")) {
    return <Smartphone className="w-4 h-4 text-gray-600" />;
  } else if (deviceLower.includes("tablet")) {
    return <Tablet className="w-4 h-4 text-gray-600" />;
  } else {
    return <Monitor className="w-4 h-4 text-gray-600" />;
  }
}
const createColumns = (
  competitorNames: string[],
  onAnalyticsClick: (keywordId: string, keyword: string) => void
): ColumnDef<RankingData>[] => {
  const baseColumns: ColumnDef<RankingData>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />
      ),
      enableSorting: false,
    },
    {
      accessorKey: "keywords",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="p-0 hover:bg-transparent"
        >
          Keywords
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const keyword = row.getValue("keywords") as string;
        const location = row?.original?.location;
        const device = row?.original?.device;
        const tags = row?.original?.tags.map((tag: string) =>
          tag.toLowerCase()
        );

        const isSitelink = tags.includes("organic");
        const isImage = tags.includes("images");
        const isVideo = tags.includes("video");
        const isFeaturedSnippet = tags.includes("featured_snippet");

        return (
          <div className="flex justify-between items-center gap-3">
            <div className="flex items-center gap-3 font-medium">
              <div className="keywordCountry-flag">
                <CountryFlag code={GetCountryCode(location)} />
              </div>

              <div className="flex items-center gap-2">
                <div className="truncate">{keyword}</div>
                <div>
                  <DeviceIcon device={device} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ul className="flex gap-1">
                <li className="keyword-iconActive">
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Image
                          src="/images/sitelinks.svg"
                          alt="sitelinks"
                          width="20"
                          height="20"
                          style={{
                            filter:
                              isSitelink === true
                                ? "none"
                                : "grayscale(100%) opacity(0.5)",
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="bg-black text-white px-3 py-1 text-xs rounded-md shadow-md"
                      >
                        Sitelinks
                        <TooltipPrimitive.Arrow className="fill-black" />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </li>

                <li className="keyword-iconDisabled">
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Image
                          src="/images/image-icon.svg"
                          alt="image-icon"
                          width="20"
                          height="20"
                          style={{
                            filter:
                              isImage === true
                                ? "none"
                                : "grayscale(100%) opacity(0.5)",
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="bg-black text-white px-3 py-1 text-xs rounded-md shadow-md"
                      >
                        Image
                        <TooltipPrimitive.Arrow className="fill-black" />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </li>

                <li className="keyword-iconActive">
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Image
                          src="/images/video-icon.svg"
                          alt="video-icon "
                          width="20"
                          height="20"
                          style={{
                            filter:
                              isVideo === true
                                ? "none"
                                : "grayscale(100%) opacity(0.5)",
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="bg-black text-white px-3 py-1 text-xs rounded-md shadow-md"
                      >
                        Video
                        <TooltipPrimitive.Arrow className="fill-black" />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </li>
                <li className="keyword-iconDisabled">
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Image
                          src="/images/featured-snippet-icon.svg"
                          alt="featured-snippet-icon"
                          width="20"
                          height="20"
                          style={{
                            filter:
                              isFeaturedSnippet === true
                                ? "none"
                                : "grayscale(100%) opacity(0.5)",
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="bg-black text-white px-3 py-1 text-xs rounded-md shadow-md"
                      >
                        Featured Snippet
                        <TooltipPrimitive.Arrow className="fill-black" />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </li>
              </ul>

              <AnalyticsButton
                keywordId={row.original.id}
                keyword={row.original.keywords}
                onAnalyticsClick={onAnalyticsClick}
              />
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "myRankings",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="p-0 hover:bg-transparent"
        >
          My Rankings
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const ranking = row.getValue("myRankings");
        const aiTracking = row.original.targetAI;
        const isDataFetched = row.original.isDataFetched;
        const keywordId = row.original.id;
        const keyword = row.original.keywords;

        return (
          <div className="text-left flex items-center gap-3 font-medium">
            {ranking as React.ReactNode}
            <AIIcons aiTracking={aiTracking} isDataFetched={isDataFetched} />
          </div>
        );
      },
    },
  ];

  const competitorColumns: ColumnDef<RankingData>[] = competitorNames.map(
    (competitorName, index) => ({
      accessorKey: `competitor${index}`,
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="p-0 hover:bg-transparent"
        >
          {competitorName}
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const competitor = row.original.competitors[index];
        const isDataFetched = row.original.isDataFetched;

        if (!competitor) {
          return (
            <div className="text-left flex items-center gap-3 font-medium">
              -
            </div>
          );
        }

        return (
          <div className="text-left flex items-center gap-3 font-medium">
            {competitor.ranking}
            <AIIcons
              aiTracking={competitor.aiTracking}
              isDataFetched={isDataFetched}
            />
          </div>
        );
      },
      sortingFn: (rowA, rowB, columnId) => {
        const compA = rowA.original.competitors[index];
        const compB = rowB.original.competitors[index];

        if (!compA && !compB) return 0;
        if (!compA) return 1;
        if (!compB) return -1;

        const rankingA = typeof compA.ranking === "string" ? compA.ranking : "";
        const rankingB = typeof compB.ranking === "string" ? compB.ranking : "";

        if (rankingA === ">100" && rankingB === ">100") return 0;
        if (rankingA === ">100") return 1;
        if (rankingB === ">100") return -1;

        const numA = parseInt(rankingA) || 999;
        const numB = parseInt(rankingB) || 999;

        return numA - numB;
      },
    })
  );

  return [...baseColumns, ...competitorColumns];
};

export function DataTable({ domain }: { domain: string }) {
  const dispatch = useAppDispatch();
  const { dashboardRankings, loading } = useAppSelector(
    (state) => state.rankTracker
  );

  const { showToast } = useToast();

  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(
    null
  );
  const [selectedKeyword, setSelectedKeyword] = useState<string>("");
  const [analysisData, setAnalysisData] = useState<KeywordAnalysisData | null>(
    null
  );
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  useEffect(() => {
    if(domain){
    dispatch(getDashboardRankings({ targetDomain: domain }));
    }
  }, [dispatch, domain]);

  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [rowSelection, setRowSelection] = React.useState({});
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleAnalyticsClick = async (keywordId: string, keyword: string) => {
    setSelectedKeywordId(keywordId);
    setSelectedKeyword(keyword);
    setLoadingAnalysis(true);
    setShowAnalyticsModal(true);
    setAnalysisData(null);

    try {
      const result = await dispatch(getKeywordAnalysis(keywordId)).unwrap();
      const data = result;
      setAnalysisData(data);
    } catch (error) {
      console.error("Failed to fetch keyword analysis:", error);
      showToast("Failed to fetch keyword analysis", "error");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const handleModalClose = () => {
    setShowAnalyticsModal(false);
    setSelectedKeywordId(null);
    setSelectedKeyword("");
    setAnalysisData(null);
  };

  const tableData = useMemo(() => {
    return transformApiData(dashboardRankings || []);
  }, [dashboardRankings]);

  const { maxCompetitors, competitorNames } = useMemo(() => {
    const maxComp = getMaxCompetitors(dashboardRankings || []);
    const names = getCompetitorNames(dashboardRankings || [], maxComp);
    return { maxCompetitors: maxComp, competitorNames: names };
  }, [dashboardRankings]);

  const columns = useMemo(() => {
    return createColumns(competitorNames, handleAnalyticsClick);
  }, [competitorNames]);

  const table = useReactTable({
    data: tableData,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
  });

  const handleDeleteSelected = async () => {
    const selectedRows = table.getSelectedRowModel().rows;
    const selectedKeywordIds = selectedRows.map((row) => row.original.id);

    if (selectedKeywordIds.length === 0) {
      showToast("No keywords selected", "error");
      return;
    }

    setIsDeleting(true);

    try {
      const result = await dispatch(
        bulkRemoveKeywords(selectedKeywordIds)
      ).unwrap();

      showToast(`Successfully deleted keywords`, "success");

      // Support legacy or API response structure where failures may be on result or result.result
      const failedRemovals =
        (result.result && result.result.failedRemovals) 

      if (failedRemovals && failedRemovals.length > 0) {
        showToast(
          `Failed to delete ${failedRemovals.length} keyword${
            failedRemovals.length > 1 ? "s" : ""
          }`,
          "error"
        );
      }

      setRowSelection({});

      await dispatch(getDashboardRankings({ targetDomain: domain }));
    } catch (error: any) {
      console.error("Error deleting keywords:", error);
      showToast(error && typeof error === "object" && "message" in error ? (error as any).message : "Failed to delete keywords", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!dashboardRankings) {
    return (
      <div className="w-full p-8 text-center">
        <div className="text-lg">Loading rankings...</div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between pb-4 ">
        <div>
          {table.getSelectedRowModel().rows.length > 0 && (
            <Button
              variant="destructive"
              onClick={handleDeleteSelected}
              disabled={isDeleting || loading}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isDeleting ? (
                <>
                  <LoadingSpinner size="small" color="#fff" />
                  <span className="ml-2">Deleting...</span>
                </>
              ) : (
                `Delete Selected (${table.getSelectedRowModel().rows.length})`
              )}
            </Button>
          )}
        </div>
        <Input
          placeholder="Search keywords..."
          value={
            (table.getColumn("keywords")?.getFilterValue() as string) ?? ""
          }
          onChange={(event) =>
            table.getColumn("keywords")?.setFilterValue(event.target.value)
          }
          className="max-w-sm"
        />
      </div>

      <div className="border-table border border-[#dee2e6] rounded-xl">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No keywords found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-muted-foreground flex-1 text-sm">
          {table.getSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Analytics Modal */}
      <AnalyticsModal
        isOpen={showAnalyticsModal}
        onClose={handleModalClose}
        keyword={selectedKeyword}
        analysisData={analysisData}
        loading={loadingAnalysis}
        onRetry={() =>
          selectedKeywordId &&
          handleAnalyticsClick(selectedKeywordId, selectedKeyword)
        }
      />
    </div>
  );
}

export default function RankTrackerTable({ domain }: { domain: string }) {
  return (
    <TooltipProvider delayDuration={0}>
      <DataTable domain={domain} />
    </TooltipProvider>
  );
}
