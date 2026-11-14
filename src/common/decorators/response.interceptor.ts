import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from "@nestjs/common";
import { map, Observable } from "rxjs";

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(
            map((data) => {
                if (data instanceof StreamableFile) return data;
                if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
                    return { success: true, ...data };
                }
                return { success: true, data };
            }),
        );
    }
}