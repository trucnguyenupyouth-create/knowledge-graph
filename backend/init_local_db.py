import sqlite3
import csv
import uuid
import os

DB_PATH = "math_graph.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create nodes table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            concept_code TEXT UNIQUE NOT NULL,
            grade_level INTEGER NOT NULL,
            topic_category TEXT NOT NULL,
            concept_name_vn TEXT NOT NULL,
            concept_description TEXT,
            mastery_question TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create edges table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            target_node_id TEXT NOT NULL,
            source_node_id TEXT NOT NULL,
            relationship_type TEXT NOT NULL,
            FOREIGN KEY (target_node_id) REFERENCES nodes (id) ON DELETE CASCADE,
            FOREIGN KEY (source_node_id) REFERENCES nodes (id) ON DELETE CASCADE,
            CONSTRAINT edges_no_self_loop CHECK (source_node_id != target_node_id),
            CONSTRAINT edges_unique_pair UNIQUE (target_node_id, source_node_id)
        )
    """)

    conn.commit()
    return conn

def import_csv_to_sqlite():
    conn = init_db()
    cursor = conn.cursor()
    code_to_id = {}

    print("Importing nodes...")
    with open("data/nodes.csv", "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            node_id = str(uuid.uuid4())
            concept_code = row["concept_code"].strip()
            # Clean grade level e.g. "G7" -> 7
            raw_grade = row["grade_level"].strip()
            grade_level = int(raw_grade.replace("G", ""))
            
            cursor.execute("""
                INSERT OR IGNORE INTO nodes (id, concept_code, grade_level, topic_category, concept_name_vn, concept_description, mastery_question)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                node_id,
                concept_code,
                grade_level,
                row["topic_category"].strip(),
                row["concept_name_vn"].strip(),
                row["concept_description"].strip(),
                row["mastery_question"].strip()
            ))
            
            # Fetch the actual ID in case it was already inserted
            cursor.execute("SELECT id FROM nodes WHERE concept_code=?", (concept_code,))
            code_to_id[concept_code] = cursor.fetchone()[0]

    print("Importing edges...")
    with open("data/edges.csv", "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            edge_id = str(uuid.uuid4())
            target_code = row["target_concept_code"].strip()
            source_code = row["source_concept_code"].strip()
            rel_type = row["relationship_type"].strip()
            
            target_id = code_to_id.get(target_code)
            source_id = code_to_id.get(source_code)
            
            if target_id and source_id:
                cursor.execute("""
                    INSERT OR IGNORE INTO edges (id, target_node_id, source_node_id, relationship_type)
                    VALUES (?, ?, ?, ?)
                """, (edge_id, target_id, source_id, rel_type))
            else:
                print(f"Warning: Missing node mapping for edge {source_code} -> {target_code}")

    conn.commit()
    conn.close()
    print("Database initialization complete.")

if __name__ == "__main__":
    import_csv_to_sqlite()
