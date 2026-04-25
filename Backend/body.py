from pydantic import BaseModel

class HTMLRequestBody(BaseModel):
    html: str