"use client";
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { MoveLeft, X, AlertCircle, Loader2 } from "lucide-react";
import DropdownCustom from "../../../components/dropdown";
import AddKeywordTable from "./addKeywordTable";
import KeywordSuggestionTable from "./keywordSuggestionTable";
import CompetitorsSuggestionTable from "./competitorsSuggestionTable";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addKeyword,
  getKeywords,
  getKeywordSuggestions,
  syncCompetitors,
  getCompetitors,
  getCompetitorSuggestions,
  clearError as clearRankTrackerError,
} from "@/store/slices/rankTrackerSlice";
import { refreshUserPlan } from "@/store/slices/userPlanSlice";
import { AddKeywordRequest } from "@/types/rankTracker";
import { showToast } from "@/lib/toast";

const dropdownLocation = [
  { value: "United States", label: "United States" },
  { value: "India", label: "India" },
];

const dropdownDevice = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

const dropdownSearchEngine = [
  { value: "google", label: "Google.com" },
  { value: "bing", label: "Bing.com" },
  { value: "yahoo", label: "Yahoo.com" },
];

const dropdownLanguage = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
];

const KeywordTag = React.memo(
  ({
    keyword,
    index,
    onRemove,
  }: {
    keyword: string;
    index: number;
    onRemove: (index: number) => void;
  }) => {
    const handleRemove = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onRemove(index);
      },
      [index, onRemove]
    );

    return (
      <div className="inline-flex items-center gap-1 px-3 py-1 bg-[#f0f1f4] text-black rounded-full text-sm border border-[#e5e7eb] hover:bg-[#d0d2d6] transition-colors">
        <span>{keyword}</span>
        <button
          onClick={handleRemove}
          className="hover:bg-[#b8b9bb] rounded-full p-0.5 transition-colors"
          aria-label={`Remove ${keyword}`}
        >
          <X size={12} />
        </button>
      </div>
    );
  }
);
KeywordTag.displayName = "KeywordTag";

const CompetitorInput = React.memo(
  ({
    competitor,
    index,
    onChange,
    onClear,
  }: {
    competitor: string;
    index: number;
    onChange: (index: number, value: string) => void;
    onClear: (index: number) => void;
  }) => {
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(index, e.target.value);
      },
      [index, onChange]
    );

    const handleClear = useCallback(() => {
      onClear(index);
    }, [onClear, index]);

    return (
      <div className="flex justify-between items-center gap-2">
        <div className="relative w-full">
          <input
            type="text"
            maxLength={50}
            id={`floating_outlined${index + 1}`}
            value={competitor || ""}
            onChange={handleChange}
            className="h-[38px] block rounded-md pl-3 pr-12 py-3 w-full text-sm text-gray-900 bg-transparent border border-[#dee2e6] appearance-none focus:outline-none focus:ring-0 focus:border-slate-400 peer"
            placeholder=""
          />

          <label
            htmlFor={`floating_outlined${index + 1}`}
            className="absolute cursor-text text-slate-400 text-xs duration-300 transform -translate-y-4 scale-75 top-2 origin-[0] bg-white px-2 peer-focus:px-2 peer-focus:font-semibold peer-focus:text-sm peer-focus:text-black peer-placeholder-shown:scale-100 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:top-1/2 peer-focus:top-2 peer-focus:scale-75 peer-focus:-translate-y-4 rtl:peer-focus:translate-x-1/4 rtl:peer-focus:left-auto start-1"
          >
            COMPETITOR {index + 1}
          </label>

          {competitor && (
            <button
              onClick={handleClear}
              className="p-0 absolute top-1/2 -translate-y-1/2 right-[7px] h-6 w-6 text-gray-400 hover:text-gray-600"
              title="Clear input"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }
);
CompetitorInput.displayName = "CompetitorInput";

export default function AddKeyword() {
  const dispatch = useAppDispatch();
  const { competitors, error: rankTrackerError } = useAppSelector(
    (state) => state.rankTracker
  );
  const {
    userPlan,
    loading: planLoading,
    error: userPlanError,
  } = useAppSelector((state) => state.userPlan);

  const activeDomain = useMemo(
    () => userPlan?.activeDomain || userPlan?.activeDomainDetails?.domain,
    [userPlan?.activeDomain, userPlan?.activeDomainDetails?.domain]
  );

  const [isSubmittingKeywords, setIsSubmittingKeywords] = useState(false);
  const [isSubmittingCompetitors, setIsSubmittingCompetitors] = useState(false);

  const [inputKeywords, setInputKeywords] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [seoSettings, setSeoSettings] = useState<{ location: string; device: string; searchEngine: any; language: string }[] | null>(null);

  const [formData, setFormData] = useState({
    location: "United States",
    device: "desktop",
    searchEngine: "google",
    language: "en",
  });

  const [competitorInputs, setCompetitorInputs] = useState<string[]>(["", "", ""]);
  const [initialCompetitorState, setInitialCompetitorState] = useState<string[]>(["", "", ""]);

  const [initialSuggestionsLoaded, setInitialSuggestionsLoaded] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchSeoSettings = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/rank-tracker/seo-settings`
      );
      const data = await res.json();
      setSeoSettings(data);
    } catch (err) {
      console.error("Error fetching SEO settings:", err);
    }
  }, []);

  const extractNameFromDomain = useCallback((domain: string): string => {
    try {
      const cleanDomain = domain.replace(/^https?:\/\//, "");
      const withoutWww = cleanDomain.replace(/^www\./, "");
      const parts = withoutWww.split(".");
      return parts[0] || domain;
    } catch (error) {
      return domain;
    }
  }, []);

  const canSubmitKeywords = useMemo(
    () => inputKeywords.length > 0 && activeDomain && !isSubmittingKeywords,
    [inputKeywords.length, activeDomain, isSubmittingKeywords]
  );

  const hasCompetitorChanges = useMemo(() => {
    return JSON.stringify(competitorInputs) !== JSON.stringify(initialCompetitorState);
  }, [competitorInputs, initialCompetitorState]);

  const canSubmitCompetitors = useMemo(
    () => hasCompetitorChanges && !isSubmittingCompetitors,
    [hasCompetitorChanges, isSubmittingCompetitors]
  );

  const addKeywordToList = useCallback(
    (keyword: string) => {
      const trimmedKeyword = keyword.trim();
      if (trimmedKeyword && !inputKeywords.includes(trimmedKeyword)) {
        setInputKeywords((prev) => [...prev, trimmedKeyword]);
        setInputValue("");
      }
    },
    [inputKeywords]
  );

  const removeKeywordFromList = useCallback(
    (indexToRemove: number) => {
      setInputKeywords((prev) =>
        prev.filter((_, index) => index !== indexToRemove)
      );
    },
    []
  );

  const addMultipleKeywordsToList = useCallback(
    (keywords: string[]) => {
      const newKeywords = keywords.filter((keyword) => {
        const trimmedKeyword = keyword.trim();
        return (
          trimmedKeyword &&
          !inputKeywords.some(
            (existing) =>
              existing.toLowerCase() === trimmedKeyword.toLowerCase()
          )
        );
      });

      if (newKeywords.length > 0) {
        setInputKeywords((prev) => [...prev, ...newKeywords]);
      }
    },
    [inputKeywords]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addKeywordToList(inputValue);
      } else if (
        e.key === "Backspace" &&
        inputValue === "" &&
        inputKeywords.length > 0
      ) {
        removeKeywordFromList(inputKeywords.length - 1);
      }
    },
    [inputValue, inputKeywords.length, addKeywordToList, removeKeywordFromList]
  );

  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const handleFormDataChange = useCallback((field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const addCompetitorToInput = useCallback(
    (domain: string) => {
      const trimmedDomain = domain.trim().toLowerCase();
      if (!trimmedDomain) return;

      const existsInInputs = competitorInputs.some(
        (input) => input.trim().toLowerCase() === trimmedDomain
      );
      if (existsInInputs) {
        return;
      }

      const firstEmptyIndex = competitorInputs.findIndex(
        (input) => !input.trim()
      );
      if (firstEmptyIndex !== -1) {
        setCompetitorInputs((prev) => {
          const newInputs = [...prev];
          newInputs[firstEmptyIndex] = trimmedDomain;
          return newInputs;
        });
      }
    },
    [competitorInputs]
  );

  const handleCompetitorInputChange = useCallback(
    (index: number, value: string) => {
      setCompetitorInputs((prev) => {
        const newInputs = [...prev];
        newInputs[index] = value || "";
        return newInputs;
      });
    },
    []
  );

  const clearCompetitorInput = useCallback((index: number) => {
    setCompetitorInputs((prev) => {
      const newInputs = [...prev];
      newInputs[index] = "";
      return newInputs;
    });
  }, []);

  const validateFormData = useCallback(() => {
    const errors: string[] = [];

    if (inputKeywords.length === 0) {
      errors.push("At least one keyword is required");
    }

    if (!activeDomain) {
      errors.push("No active domain found. Please add a domain first.");
    }

    return errors;
  }, [inputKeywords.length, activeDomain]);

  const validateCompetitors = useCallback(() => {
    const errors: string[] = [];

    const validCompetitors = competitorInputs.filter((input) => input.trim());

    if (validCompetitors.length === 0) {
      errors.push("Please add at least one competitor");
    }

    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/;
    const invalidDomains = validCompetitors.filter(
      (domain) => !domainRegex.test(domain)
    );
    if (invalidDomains.length > 0) {
      errors.push(`Invalid domain format: ${invalidDomains.join(", ")}`);
    }

    return errors;
  }, [competitorInputs]);

  const handleSubmitKeywords = useCallback(async () => {
    const errors = validateFormData();
    if (errors.length > 0) {
      errors.forEach((error) => showToast(error, "error"));
      return;
    }

    if (!activeDomain) {
      showToast("No active domain found", "error");
      return;
    }

    setIsSubmittingKeywords(true);

    try {
      const addedKeywords = [];
      const failedKeywords = [];

      for (const keyword of inputKeywords) {
        try {
          const request: AddKeywordRequest = {
            keyword: keyword.trim(),
            targetDomain: activeDomain,
            location: formData.location,
            device: formData.device,
            language: formData.language,
            searchEngine: formData.searchEngine,
            tags: [],
          };

          await dispatch(addKeyword(request)).unwrap();
          addedKeywords.push(keyword);
        } catch (err) {
          console.log(err);
          failedKeywords.push(keyword);
        }
      }

      if (addedKeywords.length > 0) {
        setInputKeywords([]);
        setInputValue("");
        dispatch(getKeywords({ page: undefined, limit: undefined, search: undefined }));
        await dispatch(refreshUserPlan());
        showToast(
          `Successfully added ${addedKeywords.length} keyword(s)`,
          "success"
        );
      }

      if (failedKeywords.length > 0) {
        showToast(
          `Failed to add ${failedKeywords.length} keyword(s): ${failedKeywords.join(", ")}`,
          "error"
        );
      }
    } catch (err) {
      console.error("Failed to add keywords:", err);
      showToast("Failed to add keywords. Please try again.", "error");
    } finally {
      setIsSubmittingKeywords(false);
    }
  }, [validateFormData, activeDomain, inputKeywords, formData, dispatch]);

  const handleSubmitCompetitors = useCallback(async () => {
    const errors = validateCompetitors();
    if (errors.length > 0) {
      errors.forEach((error) => showToast(error, "error"));
      return;
    }

    setIsSubmittingCompetitors(true);

    try {
      const inputCompetitorDomains = competitorInputs
        .filter((input) => input.trim())
        .map((input) => input.trim().toLowerCase());

      const competitorsData = inputCompetitorDomains.map((domain) => ({
        domain: domain,
        name: extractNameFromDomain(domain),
      }));

      await dispatch(syncCompetitors(competitorsData as any)).unwrap();

      await dispatch(getCompetitors());

      setInitialCompetitorState([...competitorInputs]);
      showToast("Competitors updated successfully", "success");
    } catch (err: any) {
      console.error("Failed to update competitors:", err);
      showToast(err || "Failed to update competitors", "error");
    } finally {
      setIsSubmittingCompetitors(false);
    }
  }, [
    validateCompetitors,
    competitorInputs,
    dispatch,
    extractNameFromDomain,
  ]);

  useEffect(() => {
    fetchSeoSettings();
  }, [fetchSeoSettings]);

  useEffect(() => {
    dispatch(getCompetitors());
    dispatch(getKeywords({ page: undefined, limit: undefined, search: undefined }));
    dispatch(refreshUserPlan());
  }, [dispatch]);

  useEffect(() => {
    if (activeDomain && !initialSuggestionsLoaded && !planLoading) {
      dispatch(
        getKeywordSuggestions({ targetDomain: activeDomain, limit: 20 })
      );
      dispatch(
        getCompetitorSuggestions({ targetDomain: activeDomain, limit: 10 })
      );
      setInitialSuggestionsLoaded(true);
    }
  }, [activeDomain, planLoading, initialSuggestionsLoaded, dispatch]);

  useEffect(() => {
    if (competitors && competitors.length >= 0) {
      const newInputs = ["", "", ""];

      competitors.forEach((competitor, index) => {
        if (index < 3) {
          newInputs[index] = competitor.domain || "";
        }
      });

      setCompetitorInputs(newInputs);
      setInitialCompetitorState(newInputs);
    }
  }, [competitors]);

  useEffect(() => {
    if (inputKeywords.length > 0 && activeDomain && initialSuggestionsLoaded) {
      const debounceTimeout = setTimeout(() => {
        dispatch(
          getKeywordSuggestions({ targetDomain: activeDomain, limit: 20 })
        );
      }, 500);

      return () => clearTimeout(debounceTimeout);
    }
  }, [inputKeywords.length, activeDomain, dispatch, initialSuggestionsLoaded]);

  useEffect(() => {
    if (inputKeywords.length > 0 && activeDomain && initialSuggestionsLoaded) {
      const debounceTimeout = setTimeout(() => {
        dispatch(
          getCompetitorSuggestions({ targetDomain: activeDomain, limit: 10 })
        );
      }, 500);

      return () => clearTimeout(debounceTimeout);
    }
  }, [inputKeywords.length, activeDomain, dispatch, initialSuggestionsLoaded]);

  useEffect(() => {
    if (rankTrackerError) {
      showToast(rankTrackerError, "error");
      dispatch(clearRankTrackerError());
    }
  }, [rankTrackerError, dispatch]);

  useEffect(() => {
    if (userPlanError) {
      showToast(userPlanError, "error");
    }
  }, [userPlanError]);

  if (planLoading) {
    return (
      <section className="content-frame-main">
        <div className="content-frame-inner py-6 px-6">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-gray-600" />
            <span className="ml-2 text-gray-600">Loading user plan...</span>
          </div>
        </div>
      </section>
    );
  }

  if (!activeDomain) {
    return (
      <section className="content-frame-main">
        <div className="content-frame-inner py-6 px-6">
          <div className="page-head flex justify-between mb-6">
            <div className="page-headLeft flex items-center gap-2">
              <Link
                href="/rank-tracker"
                className="bg-gray-50 border border-slate-200 w-[46px] h-[38px] flex rounded-lg justify-center items-center"
              >
                <MoveLeft />
              </Link>
              <h1 className="text-black text-xl font-semibold leading-tight">
                Add Keyword
              </h1>
            </div>
          </div>

          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600" />
              <div className="text-yellow-800">
                <div className="font-medium">No Active Domain Found</div>
                <div className="text-sm mt-1">
                  Please add and activate a domain first before adding keywords.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="content-frame-main">
        <div className="content-frame-inner py-6 px-6">
          <div className="page-head flex justify-between mb-6">
            <div className="page-headLeft flex items-center gap-2">
              <Link
                href="/rank-tracker"
                className="bg-gray-50 border border-slate-200 w-[46px] h-[38px] flex rounded-lg justify-center items-center"
              >
                <MoveLeft />
              </Link>
              <div className="flex-1 flex-col">
                <h1 className="text-black text-xl font-semibold leading-tight">
                  Add Keywords for {activeDomain}
                </h1>
                {userPlan && (
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span>Keywords:</span>
                      <span className="font-medium">
                        {userPlan.rankTracker.usage.keywordsUsed} /{" "}
                        {userPlan.rankTracker.limits.keywords === -1
                          ? "∞"
                          : userPlan.rankTracker.limits.keywords}
                      </span>
                    </div>
                  
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span>Plan:</span>
                      <span className="font-medium capitalize text-blue-600">
                        {userPlan.rankTracker.plan}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="page-headRight flex gap-4">
              <Link
                href="/"
                className="bg-gray-50 border border-slate-200 w-[46px] h-[38px] flex rounded-lg justify-center"
              >
                <Image
                  src="/images/logout-icon.svg"
                  alt=""
                  width="20"
                  height="20"
                />
              </Link>

              <Link
                href="/"
                className="bg-white border border-slate-200 w-[46px] h-[38px] flex rounded-lg justify-center"
              >
                <Image
                  src="/images/hamburger-menu.svg"
                  alt=""
                  width="16"
                  height="14"
                />
              </Link>
            </div>
          </div>

          <div className="add-keywordArea">
            <div className="grid grid-cols-[60%_40%] gap-4">
              <div className="card bg-white rounded-xl px-4 py-4">
                <h4 className="scroll-m-20 text-lg font-semibold tracking-tight mb-5">
                  Add Keywords
                </h4>

                <div className="flex gap-5 flex-col">
                  <div className="custom-textarea relative w-full">
                    <span className="textarea-heading block text-sm font-medium text-gray-700 mb-2 ">
                      Keywords for {activeDomain}
                    </span>

                    <div
                      className="form-control min-h-[120px] overflow-auto p-3 border border-[#e5e7eb] rounded-md focus-within:ring focus-within:ring-[#95979a] focus-within:border-[#95979a] cursor-text bg-white"
                      onClick={handleContainerClick}
                    >
                      <div className="flex flex-wrap gap-2 mb-2">
                        {inputKeywords.map((keyword, index) => (
                          <KeywordTag
                            key={`${keyword}-${index}`}
                            keyword={keyword}
                            index={index}
                            onRemove={removeKeywordFromList}
                          />
                        ))}
                      </div>

                      <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder={
                          inputKeywords.length === 0
                            ? "Enter Keyword (press enter to add multiple keywords)"
                            : "Add another keyword..."
                        }
                        className="w-full outline-none bg-transparent text-gray-900 placeholder-gray-500"
                        style={{ minWidth: "200px" }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-5">
                    <div className="w-2/4">
                      <DropdownCustom
                        options={dropdownLocation}
                        placeholder=""
                        defaultValue={formData.location}
                        onChange={(value) => {
                          handleFormDataChange("location", value);

                          const matchedEngine = dropdownSearchEngine.find(
                            (engine) => engine.value == value
                          );

                          if (matchedEngine) {
                            handleFormDataChange(
                              "searchEngine",
                              matchedEngine.value
                            );
                          }
                        } }                   
                       />
                    </div>

                    <div className="w-2/4">
                      <DropdownCustom
                        options={dropdownDevice}
                        placeholder=""
                        defaultValue={formData.device}
                        onChange={(value) =>
                          handleFormDataChange("device", value)
                        }
                      />
                    </div>
                  </div>

                  <div className="flex gap-5">
                    <div className="w-2/4">
                      <DropdownCustom
                        options={dropdownSearchEngine}
                        placeholder=""
                        defaultValue={formData.searchEngine}
                        onChange={(value) => {
                          handleFormDataChange("searchEngine", value);
                        }}
                      />
                    </div>

                    <div className="w-2/4">
                      <DropdownCustom
                        options={dropdownLanguage}
                        placeholder=""
                        defaultValue={formData.language}
                        onChange={(value) => handleFormDataChange("language", value)}                        
                      />
                    </div>
                  </div>

                  <div className="w-full">
                    <button
                      onClick={handleSubmitKeywords}
                      disabled={!canSubmitKeywords}
                      className="custom-btn rounded-lg py-2 px-4 border border-transparent text-center text-[13px] font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isSubmittingKeywords ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Submitting Keywords...
                        </>
                      ) : (
                        "Submit Keywords"
                      )}
                    </button>
                  </div>
                </div>

                <div className="addKeyword-table">
                  <AddKeywordTable />
                </div>
              </div>

              <div className="card bg-white rounded-xl px-4 py-4">
                <h4 className="scroll-m-20 text-lg font-semibold tracking-tight mb-5">
                  Keywords&apos; Suggestions
                </h4>

                <div className="addKeyword-table">
                  <KeywordSuggestionTable
                    onAddKeyword={addKeywordToList}
                    addedKeywords={inputKeywords}
                    onAddMultipleKeywords={addMultipleKeywordsToList}
                  />
                </div>
              </div>

              <div className="card bg-white rounded-xl px-4 py-4">
                <h4 className="scroll-m-20 text-lg font-semibold tracking-tight mb-5">
                  Add Competitors (optional)
                </h4>

                <div className="flex gap-5 flex-col">
                  <div className="flex flex-col gap-5">
                    {competitorInputs.map((competitor, index) => (
                      <CompetitorInput
                        key={index}
                        competitor={competitor}
                        index={index}
                        onChange={handleCompetitorInputChange}
                        onClear={clearCompetitorInput}
                      />
                    ))}
                  </div>

                  <div className="w-full">
                    <button
                      onClick={handleSubmitCompetitors}
                      disabled={!canSubmitCompetitors}
                      className="custom-btn rounded-lg py-2 px-4 border border-transparent text-center text-[13px] font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isSubmittingCompetitors ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving Competitors...
                        </>
                      ) : (
                        `Save Competitors`
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card bg-white rounded-xl px-4 py-4">
                <h4 className="scroll-m-20 text-lg font-semibold tracking-tight mb-5">
                  Competitors&apos; Suggestions
                </h4>

                <div className="addKeyword-table">
                  <CompetitorsSuggestionTable
                    onAddCompetitor={addCompetitorToInput}
                    competitorInputs={competitorInputs}
                    savedCompetitors={competitors}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}