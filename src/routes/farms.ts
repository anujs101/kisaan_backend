// src/routes/farms.ts
import express from "express";
import {
  createFarmHandler,
  listFarmsHandler,
  getFarmHandler,
  updateFarmHandler,
  deleteFarmHandler,
} from "@controllers/farm.controller";
import { auth } from "@middleware/auth";
import { validate } from "@middleware/validate";
import { createFarmSchema, updateFarmSchema } from "@validators/farm.schema";

/*{
  "name": "My Farm",
  "address": "Village X, Taluka Y",
  "boundary": {
    "type": "Polygon",
    "coordinates": [
      [
        [lon1, lat1],
        [lon2, lat2],
        [lon3, lat3],
        [lon1, lat1]
      ]
    ]
  }
}*/

const router = express.Router();

// All routes require authentication
router.use(auth());

router.post("/", validate(createFarmSchema, "body"), createFarmHandler);
router.get("/", listFarmsHandler);
router.get("/:id", getFarmHandler);
router.put("/:id", validate(updateFarmSchema, "body"), updateFarmHandler);
router.delete("/:id", deleteFarmHandler);

export default router;