-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gradeLevel" INTEGER NOT NULL,
    "topicCategory" TEXT NOT NULL,
    "nameVn" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "masteryQuestion" TEXT NOT NULL,
    "misconceptions" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Prerequisite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL DEFAULT 'HARD_PREREQUISITE',
    CONSTRAINT "Prerequisite_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Concept" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Prerequisite_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Concept" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BugEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conceptId" TEXT NOT NULL,
    "bugIndex" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    CONSTRAINT "BugEntry_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiagnosticHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "problem" TEXT NOT NULL,
    "studentAnswer" TEXT NOT NULL,
    "targetConceptCode" TEXT,
    "gradingResult" TEXT,
    "totalScore" REAL,
    "maxScore" REAL,
    "matchedBugIds" TEXT,
    "rootConceptIds" TEXT,
    "confidence" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "diagnosticRaw" TEXT,
    "expertNotes" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Prerequisite_targetId_sourceId_key" ON "Prerequisite"("targetId", "sourceId");

-- CreateIndex
CREATE INDEX "BugEntry_conceptId_idx" ON "BugEntry"("conceptId");

