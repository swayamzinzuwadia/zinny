/** The Data Analytics question pool for the demo (brief item 10): 40 questions across the course. */
import type { QuestionDraft } from "./lib/marking";

const sc = (prompt: string, options: string[], right: number, tags: string[], difficulty: "easy" | "medium" | "hard", explanation: string, marks = 1, negativeMarks = 0): QuestionDraft => ({
  type: "single",
  prompt,
  options,
  correct: [right],
  tags,
  difficulty,
  explanation,
  marks,
  negativeMarks,
});
const mc = (prompt: string, options: string[], right: number[], tags: string[], difficulty: "easy" | "medium" | "hard", explanation: string, marks = 2): QuestionDraft => ({
  type: "multiple",
  prompt,
  options,
  correct: right,
  tags,
  difficulty,
  explanation,
  marks,
  negativeMarks: 0.5,
});
const tf = (prompt: string, isTrue: boolean, tags: string[], difficulty: "easy" | "medium" | "hard", explanation: string): QuestionDraft => ({
  type: "true_false",
  prompt,
  isTrue,
  tags,
  difficulty,
  explanation,
  marks: 1,
});
const nu = (prompt: string, value: number, tolerance: number, tags: string[], difficulty: "easy" | "medium" | "hard", explanation: string, marks = 2): QuestionDraft => ({
  type: "numeric",
  prompt,
  value,
  tolerance,
  tags,
  difficulty,
  explanation,
  marks,
});
const sa = (prompt: string, guide: string, tags: string[], difficulty: "easy" | "medium" | "hard", marks = 4): QuestionDraft => ({
  type: "short",
  prompt,
  guide,
  tags,
  difficulty,
  explanation: guide,
  marks,
});

/** Written by Hema (HOD). */
export const HOD_QUESTIONS: QuestionDraft[] = [
  // Excel
  sc("Which Excel function returns the value from a table by matching a key in its first column?", ["VLOOKUP", "INDEX", "MATCH", "CONCAT"], 0, ["Excel", "Lookups"], "easy", "VLOOKUP searches the first column of a range and returns a value from the same row."),
  sc("In Excel, what does the $ in =$B$2 do?", ["Formats the cell as currency", "Keeps the reference fixed when the formula is copied", "Makes the cell read only", "Rounds the value"], 1, ["Excel", "Formulas"], "easy", "Dollar signs make a reference absolute, so it doesn't shift when copied."),
  sc("Which function counts the cells in a range that meet one condition?", ["COUNT", "COUNTA", "COUNTIF", "SUMIF"], 2, ["Excel", "Formulas"], "easy", "COUNTIF(range, criteria) counts cells that meet the condition."),
  mc("Which of these can summarise sales by region and month without writing formulas?", ["Pivot table", "Conditional formatting", "Pivot chart", "Data validation"], [0, 2], ["Excel", "Pivot tables"], "medium", "Pivot tables and pivot charts summarise data by drag and drop."),
  tf("XLOOKUP can search from the bottom of a range up.", true, ["Excel", "Lookups"], "medium", "XLOOKUP's search_mode argument -1 searches last to first."),
  nu("A column holds 120, 80, 100 and 140. What does =AVERAGE(A1:A4) return?", 110, 0, ["Excel", "Formulas"], "easy", "(120 + 80 + 100 + 140) / 4 = 110.", 1),
  sc("What does =IFERROR(A2/B2, 0) return when B2 is 0?", ["#DIV/0!", "0", "A2", "An empty cell"], 1, ["Excel", "Formulas"], "medium", "IFERROR returns the second argument whenever the first one errors."),
  // SQL
  sc("Which SQL clause filters groups after aggregation?", ["WHERE", "HAVING", "ORDER BY", "LIMIT"], 1, ["SQL", "Aggregation"], "medium", "HAVING filters groups; WHERE filters rows before grouping.", 2, 0.5),
  sc("Which join keeps every row from the left table, even without a match?", ["INNER JOIN", "LEFT JOIN", "CROSS JOIN", "SELF JOIN"], 1, ["SQL", "Joins"], "easy", "A LEFT JOIN keeps all left rows and fills unmatched right columns with NULL.", 2, 0.5),
  mc("Which of these are aggregate functions?", ["SUM", "COUNT", "UPPER", "AVG"], [0, 1, 3], ["SQL", "Aggregation"], "easy", "UPPER is a string function, not an aggregate."),
  tf("A primary key column can hold NULL values.", false, ["SQL", "Keys"], "easy", "Primary key columns are always NOT NULL."),
  sc("What does SELECT COUNT(*) FROM orders WHERE status = 'paid' return?", ["The number of paid orders", "The total paid amount", "Every paid order", "The number of columns"], 0, ["SQL", "Aggregation"], "easy", "COUNT(*) counts the rows that pass the WHERE clause.", 2, 0.5),
  sc("Which keyword removes duplicate rows from a result?", ["UNIQUE", "DISTINCT", "GROUP", "FILTER"], 1, ["SQL", "Basics"], "easy", "SELECT DISTINCT returns each different row once.", 2, 0.5),
  sc("A customers table has 50 rows and an orders table has 200. How many rows can an INNER JOIN on customer_id return at most?", ["50", "200", "250", "10,000"], 1, ["SQL", "Joins"], "hard", "Each order matches at most one customer, so at most 200 rows.", 2, 0.5),
  sc("Which window function gives each row its position within a partition, with ties sharing a rank and gaps after?", ["ROW_NUMBER()", "RANK()", "DENSE_RANK()", "NTILE()"], 1, ["SQL", "Window functions"], "hard", "RANK leaves gaps after ties; DENSE_RANK doesn't.", 2, 0.5),
  nu("orders has amounts 250, 400, 150 and NULL. What does SELECT AVG(amount) return?", 266.67, 0.01, ["SQL", "Aggregation"], "hard", "AVG ignores NULL: (250 + 400 + 150) / 3 = 266.67."),
  mc("Which of these would you put in a WHERE clause rather than HAVING?", ["city = 'Pune'", "SUM(amount) > 1000", "created_at >= '2026-01-01'", "COUNT(*) > 5"], [0, 2], ["SQL", "Aggregation"], "medium", "Conditions on single rows go in WHERE; conditions on aggregates go in HAVING."),
  sc("What does a CTE (WITH clause) give you?", ["A permanent table", "A named result you can use in the rest of the query", "An index", "A stored procedure"], 1, ["SQL", "CTEs"], "medium", "A CTE names a subquery for the length of one statement.", 2, 0.5),
  sa("Explain the difference between a LEFT JOIN and an INNER JOIN, with an example of when you'd use each.", "INNER keeps only matching rows. LEFT keeps every left row, with NULLs where nothing matches. Example: customers with no orders need a LEFT JOIN.", ["SQL", "Joins"], "medium"),
  // Statistics
  nu("What is the median of 3, 7, 9, 15 and 21?", 9, 0, ["Statistics"], "easy", "The middle value of the sorted list is 9.", 1),
  nu("What is the mean of 4, 8, 15, 16, 23 and 42?", 18, 0, ["Statistics"], "easy", "The sum is 108; 108 / 6 = 18.", 1),
  sc("Which measure is least affected by one very large outlier?", ["Mean", "Median", "Range", "Standard deviation"], 1, ["Statistics"], "medium", "The median depends only on the middle values."),
  tf("A correlation of -0.9 means a weak relationship.", false, ["Statistics", "Correlation"], "medium", "-0.9 is a strong negative relationship."),
  sc("Monthly sales grew from 200 to 250. What is the percentage increase?", ["20%", "25%", "50%", "80%"], 1, ["Statistics"], "easy", "(250 - 200) / 200 = 25%."),
  tf("Correlation between two variables proves that one causes the other.", false, ["Statistics", "Correlation"], "easy", "Correlation shows association, not cause."),
  sa("A dashboard shows average order value rose 30% last month. What two checks would you do before telling the business?", "Check for outliers or a few very large orders, and check whether the mix changed (fewer small orders, a promotion, a data issue). Compare the median too.", ["Statistics", "Dashboards"], "hard"),
];

/** Written by Farah (faculty on the Data Analytics batches). */
export const FACULTY_QUESTIONS: QuestionDraft[] = [
  // Visualisation and dashboards
  sc("Which chart is best for showing how one value changes over 12 months?", ["Pie chart", "Line chart", "Scatter plot", "Treemap"], 1, ["Dashboards", "Charts"], "easy", "Line charts show change over time."),
  sc("Which chart shows the relationship between two numeric variables?", ["Bar chart", "Scatter plot", "Donut chart", "Gauge"], 1, ["Dashboards", "Charts"], "easy", "A scatter plot puts one variable on each axis."),
  tf("A pie chart works well for comparing 12 categories of similar size.", false, ["Dashboards", "Charts"], "easy", "Many similar slices are hard to compare; use a sorted bar chart."),
  mc("Which make a KPI tile easier to read?", ["A comparison with last period", "3D effects", "A clear unit", "Ten decimal places"], [0, 2], ["Dashboards", "KPIs"], "medium", "Context and units help; decoration and false precision don't."),
  sc("A bar chart's y axis starts at 90 instead of 0. What's the risk?", ["Bars can't be sorted", "Small differences look much larger", "Colours can't be used", "Labels disappear"], 1, ["Dashboards", "Charts"], "medium", "Truncated axes exaggerate differences between bars."),
  sc("What is a slicer in a dashboard?", ["A filter people click to narrow the data", "A chart type", "A data source", "A formula"], 0, ["Dashboards", "Excel"], "easy", "Slicers filter pivot tables and charts by clicking."),
  // More SQL and Excel
  sc("Which SQL statement changes existing rows?", ["INSERT", "UPDATE", "ALTER", "CREATE"], 1, ["SQL", "Basics"], "easy", "UPDATE changes rows; ALTER changes the table's structure.", 2, 0.5),
  tf("ORDER BY runs before WHERE in a SQL query.", false, ["SQL", "Basics"], "medium", "Rows are filtered by WHERE first and sorted by ORDER BY last."),
  nu("A table has 1,200 rows. SELECT ... LIMIT 50 OFFSET 100 returns how many rows?", 50, 0, ["SQL", "Basics"], "easy", "LIMIT caps the result at 50 rows.", 1),
  sc("What does TRIM do in Excel?", ["Deletes empty rows", "Removes extra spaces from text", "Shortens numbers", "Removes duplicates"], 1, ["Excel", "Cleaning"], "easy", "TRIM removes leading, trailing and repeated spaces."),
  mc("Which are good first steps when cleaning a new dataset?", ["Check for duplicate rows", "Delete every row with any blank", "Check data types of each column", "Look at the minimum and maximum of numeric columns"], [0, 2, 3], ["Cleaning"], "medium", "Deleting every row with a blank can throw away good data."),
  sc("Which Excel feature stops people typing values outside a list?", ["Data validation", "Freeze panes", "Flash fill", "Goal seek"], 0, ["Excel", "Cleaning"], "easy", "Data validation restricts what can be entered in a cell."),
  sa("You are given a sales table with order_date, region and amount. Write the SQL to get total sales per region for 2026, highest first.", "SELECT region, SUM(amount) AS total FROM sales WHERE order_date >= '2026-01-01' AND order_date < '2027-01-01' GROUP BY region ORDER BY total DESC;", ["SQL", "Aggregation"], "medium"),
  tf("COUNT(column) counts NULL values in that column.", false, ["SQL", "Aggregation"], "medium", "COUNT(column) skips NULLs; COUNT(*) counts rows."),
];
