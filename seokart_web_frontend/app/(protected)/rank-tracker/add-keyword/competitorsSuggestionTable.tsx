"use client";

import React, { useState } from "react";
import { Plus, Minus, Loader2, Globe } from "lucide-react";
import { useAppSelector } from "@/store/hooks";

interface CompetitorsSuggestionTableProps {
  onAddCompetitor?: (domain: string) => void;
  competitorInputs?: string[];
  savedCompetitors?: any[];
}

const CompetitorsSuggestionTable: React.FC<CompetitorsSuggestionTableProps> = ({
  onAddCompetitor,
  competitorInputs = [],
  savedCompetitors = [],
}) => {
  const { competitorSuggestions, loading } = useAppSelector(
    (state) => state.rankTracker
  );
  const [processingCompetitor, setProcessingCompetitor] = useState<string | null>(null);

  const handleAdd = async (domain: string, name: string) => {
    const emptySlots = competitorInputs.filter((input) => !input.trim()).length;

    if (emptySlots === 0) {
      return;
    }

    setProcessingCompetitor(domain);
    try {
      if (onAddCompetitor) {
        onAddCompetitor(domain);
      }

      setTimeout(() => setProcessingCompetitor(null), 300);
    } catch (error) {
      console.error("Failed to add competitor:", error);
      setProcessingCompetitor(null);
    }
  };

  const isCompetitorInInputs = (domain: string) => {
    return competitorInputs?.some(
      (input) => input.trim().toLowerCase() === domain?.toLowerCase()
    );
  };

  const canAddMore = () => {
    const emptySlots = competitorInputs.filter((input) => !input.trim()).length;
    return emptySlots > 0;
  };

  const isCompetitorAlreadyAdded = (domain: string) => {
    return isCompetitorInInputs(domain);
  };

  if (loading && competitorSuggestions.length === 0) {
    return (
      <div className="mt-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
          <span className="ml-2 text-gray-600">
            Loading competitor suggestions...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mt-5">
      <div className="overflow-y-auto max-h-[212px] border border-gray-200 rounded-lg">
        <table className="w-full table-fixed border-collapse">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                Competitor
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                Action
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-200">
            {competitorSuggestions.map((item, index) => {
              const isAlreadyAdded = isCompetitorAlreadyAdded(
                item.competitorDomain
              );
              const isProcessing =
                processingCompetitor === item.competitorDomain;
              const canAdd = canAddMore() && !isAlreadyAdded;

              return (
                <tr
                  key={`${item.competitorDomain}-${index}`}
                  className="hover:bg-gray-50"
                >
                  <td className="px-4 py-1 text-sm text-gray-900 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-500" />
                      <div>
                        <div className="font-medium">
                          {item.competitorDomain}
                        </div>
                        {item.name && (
                          <div className="text-xs text-gray-500">
                            {item.name}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-1 text-right text-sm text-gray-900 border-b border-gray-100">
                    <button
                      onClick={() =>
                        handleAdd(item.competitorDomain, item.name)
                      }
                      disabled={isProcessing || isAlreadyAdded || !canAddMore()}
                      className={`p-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                        isAlreadyAdded
                          ? "text-gray-400 cursor-not-allowed"
                          : canAdd
                          ? "text-green-600 hover:text-green-800 hover:bg-green-50"
                          : "text-gray-400 cursor-not-allowed"
                      }`}
                      title={
                        isAlreadyAdded
                          ? "Already added"
                          : !canAddMore()
                          ? "All competitor slots are filled"
                          : "Add competitor"
                      }
                    >
                      {isProcessing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isAlreadyAdded ? (
                        <Minus className="w-4 h-4" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CompetitorsSuggestionTable;