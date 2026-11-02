import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("batches", "routes/batches.tsx"),
  route("batches/new", "routes/batch-new.tsx"),
  route("batches/:batchId", "routes/batch.tsx"),
  route("claim", "routes/claim.tsx"),
  route("activity", "routes/activity.tsx"),
] satisfies RouteConfig
