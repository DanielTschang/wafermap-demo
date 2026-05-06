package com.example.wafermap.service;

import org.springframework.stereotype.Service;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

@Service
public class MockWaferDataGenerator {

    private static final float WAFER_RADIUS = 150f;  // mm
    private static final float DIE_SIZE     = 14f;   // mm
    private static final int   GRID_HALF    = 10;    // ±10 → 21×21 iteration space, ~333 valid dies

    public byte[] generate(int requestedPoints) {
        List<float[]> dies = validDieCenters();
        int pointsPerDie = Math.max(1, requestedPoints / dies.size());
        int totalPoints  = pointsPerDie * dies.size();

        ByteBuffer buf = ByteBuffer
                .allocate(totalPoints * 6 * Float.BYTES)
                .order(ByteOrder.LITTLE_ENDIAN);

        Random rng = new Random(42);

        for (float[] center : dies) {
            // per-die systematic overlay (Gaussian, σ=10nm)
            float dieOvlX = (float) (rng.nextGaussian() * 10);
            float dieOvlY = (float) (rng.nextGaussian() * 10);

            for (int i = 0; i < pointsPerDie; i++) {
                // random position within die
                float intraX = (rng.nextFloat() - 0.5f) * DIE_SIZE;
                float intraY = (rng.nextFloat() - 0.5f) * DIE_SIZE;
                // overlay = die bias + random noise (σ=3nm)
                float ovlX = dieOvlX + (float) (rng.nextGaussian() * 3);
                float ovlY = dieOvlY + (float) (rng.nextGaussian() * 3);

                buf.putFloat(center[0]) // interX
                   .putFloat(center[1]) // interY
                   .putFloat(intraX)
                   .putFloat(intraY)
                   .putFloat(ovlX)
                   .putFloat(ovlY);
            }
        }

        return buf.array();
    }

    private List<float[]> validDieCenters() {
        List<float[]> centers = new ArrayList<>();
        for (int ix = -GRID_HALF; ix <= GRID_HALF; ix++) {
            for (int iy = -GRID_HALF; iy <= GRID_HALF; iy++) {
                float cx = ix * DIE_SIZE;
                float cy = iy * DIE_SIZE;
                // die is valid if its center fits inside the wafer circle
                if (Math.sqrt(cx * cx + cy * cy) <= WAFER_RADIUS - DIE_SIZE / 2f) {
                    centers.add(new float[]{cx, cy});
                }
            }
        }
        return centers;
    }
}
