"use client";

import { useEffect } from "react";
import { recordLessonOpenedAction } from "../actions";

/** Remembers the lesson the learner opened (for "continue learning" and last activity). Renders nothing. */
export function LessonOpened({ uni, lessonId }: { uni: string; lessonId: string }) {
  useEffect(() => {
    void recordLessonOpenedAction(uni, lessonId);
  }, [uni, lessonId]);
  return null;
}
